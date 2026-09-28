import { nanoid } from "nanoid";
import type { EventLog } from "@/core/events/event-log.js";
import type { AgentLoop, PendingToolStep } from "@/core/loop/agent-loop.js";
import type { HarnessLimits } from "@/core/loop/limits.js";
import { projectSession } from "@/core/session/project-session.js";
import { findOrphanedToolUses } from "@/core/session/session-recovery.js";
import { transition } from "@/core/session/state-machine.js";
import type { NewSessionEvent, SessionEvent } from "@/types/events.js";
import type { SessionSnapshot, SessionStopReason } from "@/types/session.js";

export class SessionTerminalError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} is terminal`);
    this.name = "SessionTerminalError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string, options?: ErrorOptions) {
    super(`Session ${sessionId} was not found`, options);
    this.name = "SessionNotFoundError";
  }
}

export class SessionManager {
  readonly #eventLog: EventLog;
  readonly #loop?: AgentLoop;
  readonly #turns = new Map<string, Promise<void>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  readonly #lastNotifiedSeq = new Map<string, number>();
  readonly #sessionLimits = new Map<string, Partial<HarnessLimits>>();
  readonly #sessionPolicies = new Map<
    string,
    "manual" | "auto_deny" | "auto_allow"
  >();
  readonly #pending = new Map<
    string,
    { decisions: Map<string, ApprovalDecision>; step: PendingToolStep }
  >();
  readonly #approvalPolicy: "manual" | "auto_deny" | "auto_allow";

  constructor(options: {
    approvalPolicy?: "manual" | "auto_deny" | "auto_allow";
    eventLog: EventLog;
    loop?: AgentLoop;
  }) {
    this.#eventLog = options.eventLog;
    this.#loop = options.loop;
    this.#approvalPolicy = options.approvalPolicy ?? "manual";
  }

  create(input: {
    approvalPolicy?: "manual" | "auto_deny" | "auto_allow";
    limits?: Partial<HarnessLimits>;
    modelId?: string;
    objective: string;
  }): SessionSnapshot {
    const id = `sess_${nanoid(16)}`;
    this.#append(id, {
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      objective: input.objective,
      type: "session.created",
    });
    if (input.limits) {
      this.#sessionLimits.set(id, input.limits);
    }
    if (input.approvalPolicy) {
      this.#sessionPolicies.set(id, input.approvalPolicy);
    }
    return this.get(id);
  }

  get(id: string): SessionSnapshot {
    try {
      return projectSession(this.#eventLog.getEvents(id));
    } catch (error) {
      throw new SessionNotFoundError(id, { cause: error });
    }
  }

  events(id: string, afterSeq = 0): SessionEvent[] {
    this.get(id);
    return this.#eventLog.getEvents(id, afterSeq);
  }

  subscribe(id: string, listener: (event: SessionEvent) => void): () => void {
    this.get(id);
    const listeners = this.#listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(id);
      }
    };
  }

  sendEvent(id: string, event: NewSessionEvent): void {
    if (isTerminal(this.get(id).status)) {
      throw new SessionTerminalError(id);
    }
    this.#append(id, event);
  }

  runTurn<T>(id: string, turn: () => Promise<T>): Promise<T> {
    const previous = this.#turns.get(id) ?? Promise.resolve();
    const current = previous.then(turn);
    this.#turns.set(
      id,
      current.then(
        () => undefined,
        () => undefined
      )
    );
    return current;
  }

  confirm(
    id: string,
    confirmation: {
      denyMessage?: string;
      result: "allow" | "deny";
      toolUseId: string;
    }
  ): Promise<SessionSnapshot> {
    return this.#decide(id, confirmation, "user");
  }

  #decide(
    id: string,
    confirmation: {
      denyMessage?: string;
      result: "allow" | "deny";
      toolUseId: string;
    },
    approver: "user" | "policy"
  ): Promise<SessionSnapshot> {
    return this.runTurn(id, async () => {
      const pending = this.#pending.get(id);
      const snapshot = this.get(id);
      if (
        !pending ||
        snapshot.status !== "requires_action" ||
        !snapshot.pendingToolUseIds.includes(confirmation.toolUseId) ||
        pending.decisions.has(confirmation.toolUseId)
      ) {
        throw new InvalidConfirmationError(confirmation.toolUseId);
      }
      if (approver === "user") {
        this.#append(id, {
          ...(confirmation.denyMessage === undefined
            ? {}
            : { denyMessage: confirmation.denyMessage }),
          result: confirmation.result,
          toolUseId: confirmation.toolUseId,
          type: "user.tool_confirmation",
        });
      }
      this.#append(id, {
        approver,
        ...(confirmation.denyMessage === undefined
          ? {}
          : { denyMessage: confirmation.denyMessage }),
        result: confirmation.result,
        toolUseId: confirmation.toolUseId,
        type: "approval.decided",
      });
      pending.decisions.set(confirmation.toolUseId, {
        result: confirmation.result,
        ...(confirmation.denyMessage === undefined
          ? {}
          : { denyMessage: confirmation.denyMessage }),
      });
      if (this.get(id).pendingToolUseIds.length > 0) {
        return this.get(id);
      }
      this.#pending.delete(id);
      this.#updateStatus(id, "running");
      const loop = this.#loop;
      if (!loop) {
        throw new Error(
          "SessionManager requires an AgentLoop to resume approval"
        );
      }
      let stopReason: SessionStopReason | undefined;
      for await (const event of loop.resumePending(
        {
          eventLog: this.#loopEventLog(),
          limits: this.#sessionLimits.get(id),
          modelId: this.get(id).modelId,
          objective: this.get(id).objective,
          onStop: (reason) => {
            stopReason = reason;
          },
          sessionId: id,
        },
        pending.step,
        pending.decisions
      )) {
        this.#notify(event);
      }
      if (stopReason) {
        this.#finish(id, stopReason);
      }
      return this.get(id);
    });
  }

  start(input: {
    approvalPolicy?: "manual" | "auto_deny" | "auto_allow";
    limits?: Partial<HarnessLimits>;
    modelId?: string;
    objective: string;
  }): Promise<SessionSnapshot> {
    if (!this.#loop) {
      throw new Error(
        "SessionManager requires an AgentLoop to start a session"
      );
    }
    const session = this.create(input);
    return this.run(session.id, input.limits);
  }

  run(id: string, limits?: Partial<HarnessLimits>): Promise<SessionSnapshot> {
    return (async () => {
      const loop = this.#loop;
      if (!loop) {
        throw new Error(
          "SessionManager requires an AgentLoop to start a session"
        );
      }
      const session = this.get(id);
      if (session.status !== "queued") {
        throw new SessionTerminalError(id);
      }
      const controller = new AbortController();
      this.#controllers.set(id, controller);
      this.#append(id, {
        content: session.objective,
        type: "user.message",
      });
      this.#updateStatus(id, "running");
      let stopReason: SessionStopReason | undefined;
      let stopDetail: unknown;
      try {
        for await (const event of loop.execute({
          eventLog: this.#loopEventLog(),
          limits: limits ?? this.#sessionLimits.get(id),
          modelId: session.modelId,
          objective: session.objective,
          onStop: (reason, detail) => {
            stopReason = reason;
            stopDetail = detail;
          },
          sessionId: id,
          signal: controller.signal,
        })) {
          this.#notify(event);
        }
      } finally {
        this.#controllers.delete(id);
      }
      await this.#completeRun(id, stopReason, stopDetail);
      return this.get(id);
    })();
  }

  interrupt(id: string): void {
    const controller = this.#controllers.get(id);
    if (controller) {
      controller.abort();
    }
  }

  recover(): Promise<SessionSnapshot[]> {
    const ids = this.#eventLog.listSessionIds?.() ?? [];
    return Promise.all(ids.map((id) => this.#recoverSession(id)));
  }

  async #recoverSession(id: string): Promise<SessionSnapshot> {
    const events = this.#eventLog.getEvents(id);
    const snapshot = this.get(id);
    if (snapshot.status === "requires_action" && this.#loop) {
      await this.#restorePending(id, events);
    } else if (snapshot.status === "running") {
      await this.#recoverRunning(id);
    }
    return this.get(id);
  }

  async #recoverRunning(id: string): Promise<void> {
    this.#updateStatus(id, "paused");
    const orphans = findOrphanedToolUses(this.#eventLog.getEvents(id));
    for (const orphan of orphans) {
      this.#append(id, {
        content: "interrupted by restart",
        isError: true,
        ...(orphan.step === undefined ? {} : { step: orphan.step }),
        toolUseId: orphan.toolUseId,
        type: "agent.tool_result",
      });
    }
    this.#updateStatus(id, "running");
    const loop = this.#loop;
    if (!loop) {
      return;
    }
    const current = this.get(id);
    const nextStep =
      Math.max(
        0,
        ...this.#eventLog
          .getEvents(id)
          .flatMap((event) =>
            event.type === "agent.tool_use" ? [event.step ?? 0] : []
          )
      ) + 1;
    let stopReason: SessionStopReason | undefined;
    for await (const event of loop.executeFrom(
      {
        eventLog: this.#loopEventLog(),
        modelId: current.modelId,
        objective: current.objective,
        onStop: (reason) => {
          stopReason = reason;
        },
        sessionId: id,
      },
      nextStep
    )) {
      this.#notify(event);
    }
    this.#finish(id, stopReason ?? "llm_error");
  }

  async #restorePending(
    id: string,
    events: ReturnType<EventLog["getEvents"]>
  ): Promise<void> {
    const loop = this.#loop;
    if (!loop) {
      return;
    }
    const snapshot = this.get(id);
    const pendingIds = new Set(snapshot.pendingToolUseIds);
    const pendingRequests = events.filter(
      (event) =>
        event.type === "approval.requested" && pendingIds.has(event.toolUseId)
    );
    const step = pendingRequests.at(-1)?.step ?? 1;
    const toolCalls = events.flatMap((event) =>
      event.type === "agent.tool_use" && event.step === step
        ? [{ id: event.toolUseId, input: event.input, name: event.name }]
        : []
    );
    const pendingStep = await loop.inspectPending(step, toolCalls);
    const decisions = new Map<string, ApprovalDecision>();
    for (const event of events) {
      if (
        event.type === "approval.decided" &&
        pendingStep.toolCalls.some(
          ({ id: pendingToolId }) => pendingToolId === event.toolUseId
        )
      ) {
        decisions.set(event.toolUseId, {
          result: event.result,
          ...(event.denyMessage === undefined
            ? {}
            : { denyMessage: event.denyMessage }),
        });
      }
    }
    this.#pending.set(id, { decisions, step: pendingStep });
  }

  async #completeRun(
    id: string,
    stopReason: SessionStopReason | undefined,
    stopDetail: unknown
  ): Promise<void> {
    if (!stopReason) {
      return;
    }
    if (stopReason === "tool_confirmation") {
      appendApprovalRequests(this.#eventLog, id, stopDetail);
      if (isPendingStepDetail(stopDetail)) {
        this.#pending.set(id, {
          decisions: new Map(),
          step: { ...stopDetail.pendingStep, step: stopDetail.step },
        });
      }
    }
    this.#finish(id, stopReason);
    if (
      stopReason === "tool_confirmation" &&
      (this.#sessionPolicies.get(id) ?? this.#approvalPolicy) !== "manual"
    ) {
      const policy = this.#sessionPolicies.get(id) ?? this.#approvalPolicy;
      const result = policy === "auto_allow" ? "allow" : "deny";
      await Promise.all(
        this.get(id).pendingToolUseIds.map((toolUseId) =>
          this.#decide(id, { result, toolUseId }, "policy")
        )
      );
    }
  }

  #updateStatus(
    id: string,
    to: SessionSnapshot["status"],
    stopReason?: SessionStopReason
  ): void {
    const from = this.get(id).status;
    transition(from, to);
    this.#append(id, {
      from,
      ...(stopReason === undefined ? {} : { stopReason }),
      to,
      type: "session.status",
    });
  }

  #finish(id: string, stopReason: SessionStopReason): void {
    this.#updateStatus(id, statusForStopReason(stopReason), stopReason);
    if (statusForStopReason(stopReason) === "failed") {
      this.#append(id, {
        code: stopReason,
        message: `Session stopped: ${stopReason}`,
        type: "session.error",
      });
    }
  }

  #append(id: string, event: NewSessionEvent): SessionEvent {
    const appended = this.#eventLog.append(id, event);
    this.#notify(appended);
    return appended;
  }

  #notify(event: SessionEvent): void {
    const lastSeq = this.#lastNotifiedSeq.get(event.sessionId) ?? 0;
    if (event.seq <= lastSeq) {
      return;
    }
    this.#lastNotifiedSeq.set(event.sessionId, event.seq);
    for (const listener of this.#listeners.get(event.sessionId) ?? []) {
      listener(structuredClone(event));
    }
  }

  #loopEventLog(): EventLog {
    const { listSessionIds } = this.#eventLog;
    return {
      append: (sessionId, event) => this.#append(sessionId, event),
      getEvents: (sessionId, afterSeq) =>
        this.#eventLog.getEvents(sessionId, afterSeq),
      latestSeq: (sessionId) => this.#eventLog.latestSeq(sessionId),
      ...(listSessionIds === undefined
        ? {}
        : { listSessionIds: () => listSessionIds.call(this.#eventLog) }),
    };
  }
}

export class InvalidConfirmationError extends Error {
  constructor(toolUseId: string) {
    super(`Tool use ${toolUseId} is not awaiting confirmation`);
    this.name = "InvalidConfirmationError";
  }
}

const statusForStopReason = (
  stopReason: SessionStopReason
): SessionSnapshot["status"] => {
  if (stopReason === "end_turn" || stopReason === "interrupted") {
    return "completed";
  }
  if (stopReason === "tool_confirmation") {
    return "requires_action";
  }
  return "failed";
};

const isTerminal = (status: SessionSnapshot["status"]): boolean =>
  status === "completed" || status === "failed";

const appendApprovalRequests = (
  eventLog: EventLog,
  sessionId: string,
  detail: unknown
): void => {
  if (!isPendingStepDetail(detail)) {
    return;
  }
  const pendingIds = new Set(detail.pendingToolUseIds);
  for (const toolCall of detail.pendingStep.toolCalls) {
    if (pendingIds.has(toolCall.id)) {
      eventLog.append(sessionId, {
        input: toolCall.input,
        name: toolCall.name,
        step: detail.step,
        toolUseId: toolCall.id,
        type: "approval.requested",
      });
    }
  }
};

interface PendingStepDetail {
  pendingStep: {
    inspections: PendingToolStep["inspections"];
    toolCalls: Array<{
      id: string;
      input: Record<string, unknown>;
      name: string;
    }>;
  };
  pendingToolUseIds: string[];
  step: number;
}

const isPendingStepDetail = (value: unknown): value is PendingStepDetail => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const detail = value as Partial<PendingStepDetail>;
  return (
    Array.isArray(detail.pendingToolUseIds) &&
    detail.pendingStep !== undefined &&
    Number.isInteger(detail.step) &&
    Array.isArray(detail.pendingStep.toolCalls) &&
    Array.isArray(detail.pendingStep.inspections)
  );
};

interface ApprovalDecision {
  denyMessage?: string;
  result: "allow" | "deny";
}
