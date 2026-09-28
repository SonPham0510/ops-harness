import { ZodError } from "zod";
import type { EventLog } from "@/core/events/event-log.js";
import {
  DEFAULT_HARNESS_LIMITS,
  type HarnessLimits,
} from "@/core/loop/limits.js";
import type { Metrics } from "@/core/observability/metrics.js";
import { eventsToMessages } from "@/core/session/events-to-messages.js";
import {
  ToolExecutor,
  type ToolInspection,
  type ToolOutcome,
} from "@/core/tools/executor.js";
import type { ToolRegistry } from "@/core/tools/registry.js";
import type { ModelResponse } from "@/model/model.js";
import {
  type ModelClient,
  ModelError,
  ModelProtocolError,
  ModelResponseSchema,
} from "@/model/model.js";
import type { SessionEvent } from "@/types/events.js";
import type { SessionStopReason } from "@/types/session.js";

const SYSTEM_PROMPT =
  "You are an operations assistant. Use tools when needed and report accurate results.";

export interface AgentLoopContext {
  eventLog: EventLog;
  limits?: Partial<HarnessLimits>;
  modelId?: string;
  objective: string;
  onStop: (reason: SessionStopReason, detail?: unknown) => void;
  sessionId: string;
  signal?: AbortSignal;
}

export interface PendingToolStep {
  inspections: ToolInspection[];
  step: number;
  toolCalls: ModelResponse["toolCalls"];
}

export class AgentLoop {
  readonly #limits: HarnessLimits;
  readonly #model: ModelClient;
  readonly #baseDelayMs: number;
  readonly #random: () => number;
  readonly #registry: ToolRegistry;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #metrics?: Metrics;
  readonly #toolExecutor: ToolExecutor;

  constructor(options: {
    baseDelayMs?: number;
    executor?: ToolExecutor;
    limits?: Partial<HarnessLimits>;
    metrics?: Metrics;
    model: ModelClient;
    random?: () => number;
    registry: ToolRegistry;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.#baseDelayMs = options.baseDelayMs ?? 100;
    this.#limits = { ...DEFAULT_HARNESS_LIMITS, ...options.limits };
    this.#model = options.model;
    this.#metrics = options.metrics;
    this.#random = options.random ?? Math.random;
    this.#registry = options.registry;
    this.#sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#toolExecutor = options.executor ?? new ToolExecutor(options.registry);
  }

  async *execute(ctx: AgentLoopContext): AsyncIterable<SessionEvent> {
    const limits = this.#limitsFor(ctx);
    const deadline = AbortSignal.timeout(limits.maxRunMs);
    const signal = AbortSignal.any([
      ctx.signal ?? new AbortController().signal,
      deadline,
    ]);
    yield* this.#executeStep(
      this.#withMetrics({ ...ctx, limits }, signal),
      1,
      deadline
    );
  }

  async *executeFrom(
    ctx: AgentLoopContext,
    firstStep: number
  ): AsyncIterable<SessionEvent> {
    const limits = this.#limitsFor(ctx);
    const deadline = AbortSignal.timeout(limits.maxRunMs);
    const signal = AbortSignal.any([
      ctx.signal ?? new AbortController().signal,
      deadline,
    ]);
    yield* this.#executeStep(
      this.#withMetrics({ ...ctx, limits }, signal),
      firstStep,
      deadline
    );
  }

  #withMetrics(ctx: AgentLoopContext, signal: AbortSignal): AgentLoopContext {
    return {
      ...ctx,
      onStop: (reason, detail) => {
        this.#metrics?.recordSession(reason);
        ctx.onStop(reason, detail);
      },
      signal,
    };
  }

  async inspectPending(
    step: number,
    toolCalls: ModelResponse["toolCalls"]
  ): Promise<PendingToolStep> {
    const inspections = await Promise.all(
      toolCalls.map((call) =>
        this.#toolExecutor.inspect({
          arguments: call.input,
          id: call.id,
          name: call.name,
        })
      )
    );
    return { inspections, step, toolCalls };
  }

  async *resumePending(
    ctx: AgentLoopContext,
    pending: PendingToolStep,
    decisions: ReadonlyMap<
      string,
      { result: "allow" | "deny"; denyMessage?: string }
    >
  ): AsyncIterable<SessionEvent> {
    const signal = ctx.signal ?? new AbortController().signal;
    const limits = this.#limitsFor(ctx);
    const trackedContext = this.#withMetrics({ ...ctx, limits }, signal);
    yield* this.#executePendingCalls(
      trackedContext,
      pending,
      decisions,
      signal
    );
    const deadline = AbortSignal.timeout(limits.maxRunMs);
    yield* this.#executeStep(trackedContext, pending.step + 1, deadline);
  }

  async *#executePendingCalls(
    ctx: AgentLoopContext,
    pending: PendingToolStep,
    decisions: ReadonlyMap<
      string,
      { result: "allow" | "deny"; denyMessage?: string }
    >,
    signal: AbortSignal,
    index = 0
  ): AsyncIterable<SessionEvent> {
    const call = pending.toolCalls[index];
    const inspection = pending.inspections[index];
    if (!(call && inspection)) {
      return;
    }
    let outcome: ToolOutcome;
    if (inspection.ok) {
      const decision = decisions.get(call.id);
      if (inspection.requiresApproval && decision?.result === "deny") {
        const reason = decision.denyMessage ?? "no reason provided";
        outcome = {
          attempts: 0,
          content: `User denied ${call.name}: ${reason}. Do not retry; report to the user instead.`,
          error: {
            code: "execution_error",
            message: `User denied ${call.name}: ${reason}`,
            retryable: false,
          },
          ok: false,
        };
      } else {
        outcome = await this.#toolExecutor.run(
          { arguments: call.input, id: call.id, name: call.name },
          { idempotencyKey: `${ctx.sessionId}:${call.id}`, signal },
          {
            onAttempt: (span) => {
              this.#metrics?.recordToolCall(call.name, span.outcome);
              this.#metrics?.observeToolDuration(call.name, span.durationMs);
              ctx.eventLog.append(ctx.sessionId, {
                attempt: span.attempt,
                durationMs: span.durationMs,
                name: call.name,
                outcome: span.outcome,
                step: pending.step,
                toolUseId: call.id,
                type: "span.tool_attempt",
              });
            },
          }
        );
      }
    } else {
      outcome = inspection;
    }
    yield ctx.eventLog.append(ctx.sessionId, {
      content: outcome.content,
      isError: !outcome.ok,
      step: pending.step,
      toolUseId: call.id,
      type: "agent.tool_result",
    });
    yield* this.#executePendingCalls(
      ctx,
      pending,
      decisions,
      signal,
      index + 1
    );
  }

  async *#executeStep(
    ctx: AgentLoopContext,
    step: number,
    deadline: AbortSignal
  ): AsyncIterable<SessionEvent> {
    const limits = this.#limitsFor(ctx);
    if (deadline.aborted) {
      ctx.onStop("timeout");
      return;
    }
    if (ctx.signal?.aborted) {
      ctx.onStop("interrupted");
      return;
    }
    if (step > limits.maxSteps) {
      yield* this.#stopAtLimit(ctx, step, "max_steps", "max_steps");
      return;
    }

    let response: ModelResponse;
    try {
      const completed = await this.#completeWithRetry(ctx, deadline, step);
      if (!completed) {
        ctx.onStop("llm_error");
        return;
      }
      response = completed;
    } catch (error) {
      if (ctx.signal?.aborted && !deadline.aborted) {
        ctx.onStop("interrupted");
        return;
      }
      if (error instanceof DeadlineExceededError) {
        ctx.onStop("timeout");
        return;
      }
      if (error instanceof ModelProtocolError || error instanceof ZodError) {
        yield* this.#handleMalformed(
          ctx,
          step,
          malformedReason(error),
          deadline
        );
        return;
      }
      throw error;
    }

    const validationError = validateResponse(response);
    if (validationError) {
      yield* this.#handleMalformed(ctx, step, validationError, deadline);
      return;
    }

    if (response.stopReason === "refusal") {
      ctx.onStop("refusal");
      return;
    }

    if (response.stopReason === "end_turn" && response.toolCalls.length === 0) {
      yield* this.#emitMessage(ctx, response, step);
      ctx.onStop("end_turn");
      return;
    }

    if (response.toolCalls.length > 0) {
      yield* this.#handleToolResponse(ctx, response, step, deadline);
    }
  }

  async *#handleToolResponse(
    ctx: AgentLoopContext,
    response: ModelResponse,
    step: number,
    deadline: AbortSignal
  ): AsyncIterable<SessionEvent> {
    const limits = this.#limitsFor(ctx);
    const previousToolCalls = ctx.eventLog
      .getEvents(ctx.sessionId)
      .filter((event) => event.type === "agent.tool_use").length;
    if (previousToolCalls + response.toolCalls.length > limits.maxToolCalls) {
      yield* this.#stopAtLimit(ctx, step, "max_tool_calls", "max_steps");
      return;
    }
    if (this.#exceedsIdenticalToolCallLimit(ctx, response, limits)) {
      ctx.onStop("loop_detected");
      return;
    }
    const inspections = await Promise.all(
      response.toolCalls.map((toolCall) =>
        this.#toolExecutor.inspect({
          arguments: toolCall.input,
          id: toolCall.id,
          name: toolCall.name,
        })
      )
    );
    yield* this.#emitMessage(ctx, response, step);
    const pendingToolUseIds = response.toolCalls.flatMap((toolCall, index) => {
      const inspection = inspections[index];
      return inspection?.ok && inspection.requiresApproval ? [toolCall.id] : [];
    });
    if (pendingToolUseIds.length > 0) {
      for (let index = 0; index < response.toolCalls.length; index += 1) {
        yield this.#toolUseEvent(ctx, response, step, index);
      }
      ctx.onStop("tool_confirmation", {
        pendingStep: { inspections, toolCalls: response.toolCalls },
        pendingToolUseIds,
        step,
      });
      return;
    }
    yield* this.#executeToolCalls(ctx, response, step);
    yield* this.#executeStep(ctx, step + 1, deadline);
  }

  async #complete(
    ctx: AgentLoopContext,
    deadline: AbortSignal
  ): Promise<ModelResponse> {
    const events = ctx.eventLog.getEvents(ctx.sessionId);
    const limits = this.#limitsFor(ctx);
    const perCallTimeout = AbortSignal.timeout(limits.modelTimeoutMs);
    const signal = AbortSignal.any([
      ctx.signal ?? new AbortController().signal,
      perCallTimeout,
    ]);
    try {
      return ModelResponseSchema.parse(
        await this.#model.complete({
          messages: [
            { content: ctx.objective, role: "user" },
            ...eventsToMessages(events),
          ],
          modelId: ctx.modelId,
          signal,
          system: SYSTEM_PROMPT,
          tools: this.#registry.specs(),
        })
      );
    } catch (error) {
      if (deadline.aborted) {
        throw deadlineExceeded(error);
      }
      if (perCallTimeout.aborted) {
        throw modelTimedOut(limits.modelTimeoutMs, error);
      }
      throw error;
    }
  }

  async #completeWithRetry(
    ctx: AgentLoopContext,
    deadline: AbortSignal,
    step: number,
    attempt = 1
  ): Promise<ModelResponse | undefined> {
    const limits = this.#limitsFor(ctx);
    const startedAt = Date.now();
    this.#metrics?.recordModelRequest();
    try {
      const response = await this.#complete(ctx, deadline);
      ctx.eventLog.append(ctx.sessionId, {
        attempt,
        durationMs: Date.now() - startedAt,
        ...(response.usage === undefined
          ? {}
          : {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
            }),
        step,
        stopReason: response.stopReason,
        type: "span.model_request",
      });
      return response;
    } catch (error) {
      ctx.eventLog.append(ctx.sessionId, {
        attempt,
        durationMs: Date.now() - startedAt,
        error: {
          message: error instanceof Error ? error.message : String(error),
          retryable: error instanceof ModelError && error.retryable,
        },
        step,
        type: "span.model_request",
      });
      if (error instanceof DeadlineExceededError) {
        throw error;
      }
      if (!(error instanceof ModelError)) {
        throw error;
      }
      if (!error.retryable || attempt > limits.modelMaxRetries) {
        return undefined;
      }
      await this.#sleep(modelBackoff(this.#baseDelayMs, attempt, this.#random));
      if (deadline.aborted) {
        throw deadlineExceeded(error);
      }
      return this.#completeWithRetry(ctx, deadline, step, attempt + 1);
    }
  }

  *#emitMessage(
    ctx: AgentLoopContext,
    response: ModelResponse,
    step: number
  ): Iterable<SessionEvent> {
    if (response.text) {
      yield ctx.eventLog.append(ctx.sessionId, {
        content: response.text,
        ...(response.raw === undefined ? {} : { raw: response.raw }),
        step,
        type: "agent.message",
      });
    }
  }

  async *#handleMalformed(
    ctx: AgentLoopContext,
    step: number,
    reason: string,
    deadline: AbortSignal
  ): AsyncIterable<SessionEvent> {
    const limits = this.#limitsFor(ctx);
    yield ctx.eventLog.append(ctx.sessionId, {
      reason,
      step,
      type: "harness.malformed_response",
    });
    const malformedCount = ctx.eventLog
      .getEvents(ctx.sessionId)
      .filter((event) => event.type === "harness.malformed_response").length;
    if (malformedCount > limits.maxMalformedResponses) {
      ctx.onStop("malformed_response");
      return;
    }
    yield ctx.eventLog.append(ctx.sessionId, {
      content:
        "Your previous response was malformed. Return a non-empty final answer or valid tool calls.",
      step,
      type: "harness.correction",
    });
    yield* this.#executeStep(ctx, step + 1, deadline);
  }

  *#stopAtLimit(
    ctx: AgentLoopContext,
    step: number,
    limit: "max_steps" | "max_tool_calls",
    reason: SessionStopReason
  ): Iterable<SessionEvent> {
    yield ctx.eventLog.append(ctx.sessionId, {
      limit,
      step,
      type: "harness.limit_hit",
    });
    ctx.onStop(reason);
  }

  #exceedsIdenticalToolCallLimit(
    ctx: AgentLoopContext,
    response: ModelResponse,
    limits: HarnessLimits
  ): boolean {
    const callCounts = new Map<string, number>();
    for (const event of ctx.eventLog.getEvents(ctx.sessionId)) {
      if (event.type !== "agent.tool_use") {
        continue;
      }
      const key = `${event.name}:${stableStringify(event.input)}`;
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
    }
    for (const toolCall of response.toolCalls) {
      const key = `${toolCall.name}:${stableStringify(toolCall.input)}`;
      const count = (callCounts.get(key) ?? 0) + 1;
      if (count > limits.maxIdenticalToolCalls) {
        return true;
      }
      callCounts.set(key, count);
    }
    return false;
  }

  async *#executeToolCalls(
    ctx: AgentLoopContext,
    response: ModelResponse,
    step: number,
    index = 0
  ): AsyncIterable<SessionEvent> {
    const toolCall = response.toolCalls[index];
    if (!toolCall) {
      return;
    }
    yield this.#toolUseEvent(ctx, response, step, index);
    const outcome = await this.#toolExecutor.run(
      {
        arguments: toolCall.input,
        id: toolCall.id,
        name: toolCall.name,
      },
      {
        idempotencyKey: `${ctx.sessionId}:${toolCall.id}`,
        signal: ctx.signal ?? new AbortController().signal,
      },
      {
        onAttempt: (span) => {
          this.#metrics?.recordToolCall(toolCall.name, span.outcome);
          this.#metrics?.observeToolDuration(toolCall.name, span.durationMs);
          ctx.eventLog.append(ctx.sessionId, {
            attempt: span.attempt,
            durationMs: span.durationMs,
            name: toolCall.name,
            outcome: span.outcome,
            step,
            toolUseId: toolCall.id,
            type: "span.tool_attempt",
          });
        },
      }
    );
    yield ctx.eventLog.append(ctx.sessionId, {
      content: outcome.content,
      isError: !outcome.ok,
      step,
      toolUseId: toolCall.id,
      type: "agent.tool_result",
    });
    yield* this.#executeToolCalls(ctx, response, step, index + 1);
  }

  #toolUseEvent(
    ctx: AgentLoopContext,
    response: ModelResponse,
    step: number,
    index: number
  ): SessionEvent {
    const toolCall = response.toolCalls[index];
    if (!toolCall) {
      throw new Error("Tool call index is out of bounds");
    }
    return ctx.eventLog.append(ctx.sessionId, {
      input: toolCall.input,
      name: toolCall.name,
      ...(!response.text && index === 0 && response.raw !== undefined
        ? { raw: response.raw }
        : {}),
      step,
      toolUseId: toolCall.id,
      type: "agent.tool_use",
    });
  }

  #limitsFor(ctx: AgentLoopContext): HarnessLimits {
    return { ...this.#limits, ...ctx.limits };
  }
}

const malformedReason = (error: ModelProtocolError | ZodError): string =>
  error instanceof ModelProtocolError
    ? error.detail
    : "Response failed schema validation";

const validateResponse = (response: ModelResponse): string | undefined => {
  if (response.stopReason === "max_tokens") {
    return "Model response stopped at max_tokens";
  }
  if (!response.text && response.toolCalls.length === 0) {
    return "Response had neither text nor tool calls";
  }
  if (response.stopReason === "tool_use" && response.toolCalls.length === 0) {
    return "tool_use stop reason had no tool calls";
  }
  if (response.toolCalls.length > 0 && response.stopReason !== "tool_use") {
    return "Tool calls require tool_use stop reason";
  }
  const uniqueIds = new Set(response.toolCalls.map(({ id }) => id));
  if (uniqueIds.size !== response.toolCalls.length) {
    return "Tool call IDs must be unique within a response";
  }
  return undefined;
};

const modelBackoff = (
  baseDelayMs: number,
  attempt: number,
  random: () => number
): number => {
  const delay = baseDelayMs * 2 ** (attempt - 1);
  const jitter = (random() * 2 - 1) * delay * 0.2;
  return Math.max(1, Math.round(delay + jitter));
};

class DeadlineExceededError extends Error {
  constructor(cause: unknown) {
    super("Agent loop deadline exceeded", { cause });
  }
}

const deadlineExceeded = (cause: unknown): DeadlineExceededError =>
  new DeadlineExceededError(cause);

const modelTimedOut = (timeoutMs: number, cause: unknown): ModelError =>
  new ModelError(`Model timed out after ${timeoutMs}ms`, true, { cause });

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortObjectKeys(value)) ?? "undefined";

const sortObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, sortObjectKeys(nestedValue)])
    );
  }
  return value;
};
