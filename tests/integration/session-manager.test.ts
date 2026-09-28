import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { JsonlEventLog } from "@/core/events/jsonl-event-log.js";
import { AgentLoop } from "@/core/loop/agent-loop.js";
import {
  InvalidConfirmationError,
  SessionManager,
  SessionNotFoundError,
  SessionTerminalError,
} from "@/core/session/session-manager.js";
import { defineTool, ToolRegistry } from "@/core/tools/registry.js";
import { ScriptedModel } from "@/model/scripted.js";
import { createOpsTools, FaultPlan } from "@/tools/ops/faults.js";
import { IncidentStore } from "@/tools/ops/incidents.js";

const SESSION_ID_PATTERN = /^sess_[A-Za-z0-9_-]{16}$/;

describe("SessionManager", () => {
  it("SES-003/EVT-007: create returns queued projected session with sess_ id and persisted modelId", () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({ eventLog });

    const session = manager.create({
      modelId: "openrouter/custom-model",
      objective: "Check checkout health",
    });

    expect(session).toEqual({
      id: expect.stringMatching(SESSION_ID_PATTERN),
      modelId: "openrouter/custom-model",
      objective: "Check checkout health",
      pendingToolUseIds: [],
      status: "queued",
    });
    expect(eventLog.getEvents(session.id)).toMatchObject([
      {
        modelId: "openrouter/custom-model",
        objective: "Check checkout health",
        type: "session.created",
      },
    ]);
    expect(manager.get(session.id)).toEqual(session);
  });

  it("SES-004: objective runs to completed with final answer", async () => {
    const eventLog = new InMemoryEventLog();
    const loop = new AgentLoop({
      model: new ScriptedModel([
        { stopReason: "end_turn", text: "Checkout is healthy.", toolCalls: [] },
      ]),
      registry: new ToolRegistry([]),
    });
    const manager = new SessionManager({ eventLog, loop });

    const session = await manager.start({ objective: "Check checkout health" });

    expect(session).toMatchObject({
      finalAnswer: "Checkout is healthy.",
      objective: "Check checkout health",
      pendingToolUseIds: [],
      status: "completed",
      stopReason: "end_turn",
    });
    expect(eventLog.getEvents(session.id).map((event) => event.type)).toEqual([
      "session.created",
      "user.message",
      "session.status",
      "span.model_request",
      "agent.message",
      "session.status",
    ]);
  });

  it("SES-004 + OBS-004: loop limit records the failed status and session error", async () => {
    const eventLog = new InMemoryEventLog();
    const loop = new AgentLoop({
      limits: { maxSteps: 1 },
      model: new ScriptedModel([
        {
          stopReason: "tool_use",
          text: "",
          toolCalls: [{ id: "call_1", input: {}, name: "unknown" }],
        },
      ]),
      registry: new ToolRegistry([]),
    });
    const manager = new SessionManager({ eventLog, loop });

    const session = await manager.start({ objective: "Keep trying" });

    expect(session).toMatchObject({
      status: "failed",
      stopReason: "max_steps",
    });
    expect(eventLog.getEvents(session.id)).toContainEqual(
      expect.objectContaining({
        code: "max_steps",
        type: "session.error",
      })
    );
  });

  it("SES-008: sending an event to a terminal session throws SessionTerminalError", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          { stopReason: "end_turn", text: "Done.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([]),
      }),
    });
    const session = await manager.start({ objective: "Finish once" });

    expect(() =>
      manager.sendEvent(session.id, {
        content: "Another turn",
        type: "user.message",
      })
    ).toThrow(SessionTerminalError);
  });

  it("SES-007: concurrent event turns are serialized", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({ eventLog });
    const session = manager.create({ objective: "Serialize events" });
    let active = 0;
    let maxActive = 0;
    const first = manager.runTurn(session.id, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      manager.sendEvent(session.id, { content: "first", type: "user.message" });
    });
    const second = manager.runTurn(session.id, () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
      manager.sendEvent(session.id, {
        content: "second",
        type: "user.message",
      });
      return Promise.resolve();
    });

    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(
      eventLog
        .getEvents(session.id)
        .filter((event) => event.type === "user.message")
        .map((event) => (event.type === "user.message" ? event.content : ""))
    ).toEqual(["first", "second"]);
  });

  it("APR-001 + APR-003 + SES-005: approval suspends session before incident handler runs", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "Preparing incident.",
            toolCalls: [
              {
                id: "call_incident",
                input: { title: "Checkout outage" },
                name: "create_incident",
              },
            ],
          },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const session = await manager.start({ objective: "Investigate checkout" });

    expect(session).toMatchObject({
      pendingToolUseIds: ["call_incident"],
      status: "requires_action",
      stopReason: "tool_confirmation",
    });
    expect(handlerCalls).toBe(0);
    expect(eventLog.getEvents(session.id)).toContainEqual(
      expect.objectContaining({
        input: { title: "Checkout outage" },
        name: "create_incident",
        toolUseId: "call_incident",
        type: "approval.requested",
      })
    );
  });

  it("APR-002: invalid approval tool input returns an error without requesting approval", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              { id: "call_invalid", input: {}, name: "create_incident" },
            ],
          },
          { stopReason: "end_turn", text: "Input was invalid.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const session = await manager.start({ objective: "Create an incident" });
    const events = eventLog.getEvents(session.id);

    expect(session.status).toBe("completed");
    expect(handlerCalls).toBe(0);
    expect(
      events.filter((event) => event.type === "approval.requested")
    ).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        isError: true,
        toolUseId: "call_invalid",
        type: "agent.tool_result",
      })
    );
  });

  it("APR-002: invalid call result stays deferred beside a valid pending approval", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              { id: "call_invalid", input: {}, name: "create_incident" },
              {
                id: "call_valid",
                input: { title: "Checkout outage" },
                name: "create_incident",
              },
            ],
          },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => Promise.resolve({ id: "inc_1" }),
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const session = await manager.start({ objective: "Create an incident" });
    const events = eventLog.getEvents(session.id);

    expect(session.pendingToolUseIds).toEqual(["call_valid"]);
    expect(
      events.filter((event) => event.type === "approval.requested")
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "agent.tool_result")
    ).toEqual([]);
  });

  it("APR-004: allow resumes the deferred step and continues to a final answer", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "Preparing incident.",
            toolCalls: [
              {
                id: "call_incident",
                input: { title: "Checkout outage" },
                name: "create_incident",
              },
            ],
          },
          { stopReason: "end_turn", text: "Created inc_1.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const pending = await manager.start({ objective: "Create an incident" });
    const completed = await manager.confirm(pending.id, {
      result: "allow",
      toolUseId: "call_incident",
    });

    expect(handlerCalls).toBe(1);
    expect(completed).toMatchObject({
      finalAnswer: "Created inc_1.",
      pendingToolUseIds: [],
      status: "completed",
      stopReason: "end_turn",
    });
    expect(
      eventLog
        .getEvents(pending.id)
        .filter((event) => event.type === "agent.tool_result")
    ).toMatchObject([{ isError: false, toolUseId: "call_incident" }]);
  });

  it("APR-005: deny skips the handler and returns the denial to the model", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "Preparing incident.",
        toolCalls: [
          {
            id: "call_incident",
            input: { title: "Checkout outage" },
            name: "create_incident",
          },
        ],
      },
      {
        stopReason: "end_turn",
        text: "No incident was created.",
        toolCalls: [],
      },
    ]);
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model,
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });
    const pending = await manager.start({ objective: "Create an incident" });

    const completed = await manager.confirm(pending.id, {
      denyMessage: "Not authorized",
      result: "deny",
      toolUseId: "call_incident",
    });

    expect(handlerCalls).toBe(0);
    expect(completed.status).toBe("completed");
    expect(model.requests[1]?.messages).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining(
          "User denied create_incident: Not authorized"
        ),
        role: "tool",
        toolCallId: "call_incident",
      })
    );
  });

  it("APR-006: a confirmation for an unknown id has no side effects", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              {
                id: "call_pending",
                input: { title: "Checkout outage" },
                name: "create_incident",
              },
            ],
          },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => Promise.resolve({ id: "inc_1" }),
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });
    const pending = await manager.start({ objective: "Create an incident" });
    const eventCount = eventLog.getEvents(pending.id).length;

    await expect(
      manager.confirm(pending.id, {
        result: "allow",
        toolUseId: "call_unknown",
      })
    ).rejects.toBeInstanceOf(InvalidConfirmationError);

    expect(eventLog.getEvents(pending.id)).toHaveLength(eventCount);
    expect(manager.get(pending.id).pendingToolUseIds).toEqual(["call_pending"]);
  });

  it("APR-007: multiple approvals wait for all decisions and preserve call order", async () => {
    const eventLog = new InMemoryEventLog();
    const handlerOrder: string[] = [];
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              { id: "call_a", input: { title: "A" }, name: "create_incident" },
              { id: "call_b", input: { title: "B" }, name: "create_incident" },
            ],
          },
          { stopReason: "end_turn", text: "Both created.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: ({ title }) => {
              handlerOrder.push(title);
              return Promise.resolve({ id: `inc_${title}` });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });
    const pending = await manager.start({ objective: "Create both incidents" });

    const afterFirst = await manager.confirm(pending.id, {
      result: "allow",
      toolUseId: "call_b",
    });
    expect(afterFirst.status).toBe("requires_action");
    expect(handlerOrder).toEqual([]);

    const completed = await manager.confirm(pending.id, {
      result: "allow",
      toolUseId: "call_a",
    });

    expect(handlerOrder).toEqual(["A", "B"]);
    expect(completed.status).toBe("completed");
    expect(
      eventLog
        .getEvents(pending.id)
        .filter((event) => event.type === "agent.tool_result")
        .map((event) =>
          event.type === "agent.tool_result" ? event.toolUseId : ""
        )
    ).toEqual(["call_a", "call_b"]);
  });

  it("APR-008: auto_allow records policy approval and uses the same ordered resume path", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const manager = new SessionManager({
      approvalPolicy: "auto_allow",
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "",
            toolCalls: [
              {
                id: "call_incident",
                input: { title: "Checkout outage" },
                name: "create_incident",
              },
            ],
          },
          { stopReason: "end_turn", text: "Incident created.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const session = await manager.start({ objective: "Create an incident" });
    const events = eventLog.getEvents(session.id);

    expect(session.status).toBe("completed");
    expect(handlerCalls).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        approver: "policy",
        result: "allow",
        toolUseId: "call_incident",
        type: "approval.decided",
      })
    );
    expect(
      events.filter((event) => event.type === "session.status")
    ).toMatchObject([
      { from: "queued", to: "running" },
      { from: "running", to: "requires_action" },
      { from: "requires_action", to: "running" },
      { from: "running", to: "completed" },
    ]);
  });

  it("APR-008: auto_deny records policy denial and skips the handler", async () => {
    const eventLog = new InMemoryEventLog();
    let handlerCalls = 0;
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_incident",
            input: { title: "Checkout outage" },
            name: "create_incident",
          },
        ],
      },
      {
        stopReason: "end_turn",
        text: "Incident creation was denied.",
        toolCalls: [],
      },
    ]);
    const manager = new SessionManager({
      approvalPolicy: "auto_deny",
      eventLog,
      loop: new AgentLoop({
        model,
        registry: new ToolRegistry([
          defineTool({
            description: "Create an incident",
            handler: () => {
              handlerCalls += 1;
              return Promise.resolve({ id: "inc_1" });
            },
            input: z.object({ title: z.string() }),
            name: "create_incident",
            output: z.object({ id: z.string() }),
            requiresApproval: true,
          }),
        ]),
      }),
    });

    const session = await manager.start({ objective: "Create an incident" });
    const events = eventLog.getEvents(session.id);

    expect(session.status).toBe("completed");
    expect(handlerCalls).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        approver: "policy",
        result: "deny",
        toolUseId: "call_incident",
        type: "approval.decided",
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        isError: true,
        toolUseId: "call_incident",
        type: "agent.tool_result",
      })
    );
  });

  it("SES-006: interrupting a running model completes with interrupted stop reason", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          (request) =>
            new Promise((_, reject) => {
              request.signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true }
              );
            }),
        ]),
        registry: new ToolRegistry([]),
      }),
    });
    const queued = manager.create({ objective: "Wait for interruption" });
    const running = manager.run(queued.id);
    setTimeout(() => manager.interrupt(queued.id), 15);

    const interrupted = await running;

    expect(interrupted).toMatchObject({
      status: "completed",
      stopReason: "interrupted",
    });
  });

  it("APR-009: recovery rebuilds pending approval and resumes a partially decided step", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ops-agent-recovery-"));
    try {
      const initialLog = new JsonlEventLog(directory);
      const sessionId = "sess_recovery_00001";
      initialLog.append(sessionId, {
        modelId: "model-before-restart",
        objective: "Create both incidents",
        type: "session.created",
      });
      initialLog.append(sessionId, {
        from: "queued",
        to: "running",
        type: "session.status",
      });
      for (const [toolUseId, title] of [
        ["call_a", "A"],
        ["call_b", "B"],
      ] as const) {
        initialLog.append(sessionId, {
          input: { title },
          name: "create_incident",
          step: 1,
          toolUseId,
          type: "agent.tool_use",
        });
        initialLog.append(sessionId, {
          input: { title },
          name: "create_incident",
          step: 1,
          toolUseId,
          type: "approval.requested",
        });
      }
      initialLog.append(sessionId, {
        from: "running",
        stopReason: "tool_confirmation",
        to: "requires_action",
        type: "session.status",
      });
      initialLog.append(sessionId, {
        approver: "user",
        result: "allow",
        toolUseId: "call_a",
        type: "approval.decided",
      });
      const reopenedLog = new JsonlEventLog(directory);
      const handlerOrder: string[] = [];
      const manager = new SessionManager({
        eventLog: reopenedLog,
        loop: new AgentLoop({
          model: new ScriptedModel([
            { stopReason: "end_turn", text: "Recovered.", toolCalls: [] },
          ]),
          registry: new ToolRegistry([
            defineTool({
              description: "Create an incident",
              handler: ({ title }) => {
                handlerOrder.push(title);
                return Promise.resolve({ id: `inc_${title}` });
              },
              input: z.object({ title: z.string() }),
              name: "create_incident",
              output: z.object({ id: z.string() }),
              requiresApproval: true,
            }),
          ]),
        }),
      });

      await manager.recover();
      expect(manager.get(sessionId)).toMatchObject({
        modelId: "model-before-restart",
        pendingToolUseIds: ["call_b"],
        status: "requires_action",
      });
      const resumed = await manager.confirm(sessionId, {
        result: "allow",
        toolUseId: "call_b",
      });

      expect(handlerOrder).toEqual(["A", "B"]);
      expect(resumed.status).toBe("completed");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("APR-009: recovery reconciles orphan tool use and resumes the running loop", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "ops-agent-running-recovery-")
    );
    try {
      const initialLog = new JsonlEventLog(directory);
      const sessionId = "sess_running_00001";
      initialLog.append(sessionId, {
        modelId: "recovered-model",
        objective: "Check service health",
        type: "session.created",
      });
      initialLog.append(sessionId, {
        from: "queued",
        to: "running",
        type: "session.status",
      });
      initialLog.append(sessionId, {
        input: { service: "checkout" },
        name: "check_service",
        step: 1,
        toolUseId: "call_orphan",
        type: "agent.tool_use",
      });
      const reopenedLog = new JsonlEventLog(directory);
      const model = new ScriptedModel([
        { stopReason: "end_turn", text: "Recovered answer.", toolCalls: [] },
      ]);
      const manager = new SessionManager({
        eventLog: reopenedLog,
        loop: new AgentLoop({ model, registry: new ToolRegistry([]) }),
      });

      const [recovered] = await manager.recover();
      const events = reopenedLog.getEvents(sessionId);

      expect(recovered).toMatchObject({
        finalAnswer: "Recovered answer.",
        modelId: "recovered-model",
        status: "completed",
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          content: "interrupted by restart",
          isError: true,
          toolUseId: "call_orphan",
          type: "agent.tool_result",
        })
      );
      expect(
        events.filter((event) => event.type === "session.status")
      ).toMatchObject([
        { from: "queued", to: "running" },
        { from: "running", to: "paused" },
        { from: "paused", to: "running" },
        { from: "running", to: "completed" },
      ]);
      expect(model.requests[0]?.modelId).toBe("recovered-model");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("OPS-004: approved incident retry after commit creates one incident", async () => {
    const eventLog = new InMemoryEventLog();
    const incidents = new IncidentStore();
    const faults = new FaultPlan();
    faults.enqueue("create_incident", { kind: "errorAfterCommit" });
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          {
            stopReason: "tool_use",
            text: "Creating incident.",
            toolCalls: [
              {
                id: "call_incident",
                input: {
                  description: "Checkout is returning errors to all customers.",
                  severity: "high",
                  title: "Checkout outage",
                },
                name: "create_incident",
              },
            ],
          },
          { stopReason: "end_turn", text: "Incident created.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([
          ...createOpsTools({ incidents: { store: incidents } }, faults),
        ]),
        sleep: () => Promise.resolve(),
      }),
    });

    const pending = await manager.start({ objective: "Create incident" });
    const completed = await manager.confirm(pending.id, {
      result: "allow",
      toolUseId: "call_incident",
    });

    expect(completed.status).toBe("completed");
    expect(incidents.size()).toBe(1);
    expect(
      eventLog
        .getEvents(pending.id)
        .filter((event) => event.type === "agent.tool_result")
    ).toHaveLength(1);
  });

  it("SES-009: subscriptions receive each appended event once in seq order", async () => {
    const eventLog = new InMemoryEventLog();
    const manager = new SessionManager({
      eventLog,
      loop: new AgentLoop({
        model: new ScriptedModel([
          { stopReason: "end_turn", text: "All clear.", toolCalls: [] },
        ]),
        registry: new ToolRegistry([]),
      }),
    });
    const session = manager.create({ objective: "Check service" });
    const received: number[] = [];
    let unsubscribe = (): void => undefined;
    unsubscribe = manager.subscribe(session.id, (event) => {
      received.push(event.seq);
      if (received.length === 1) {
        unsubscribe();
      }
    });

    await manager.run(session.id);

    expect(received).toHaveLength(1);
    expect(received).toEqual([...received].sort((left, right) => left - right));
    expect(new Set(received).size).toBe(received.length);
    expect(manager.events(session.id).map((event) => event.seq)).toEqual(
      expect.arrayContaining(received)
    );
  });

  it("SES-009: subscribing to an unknown session throws", () => {
    const manager = new SessionManager({ eventLog: new InMemoryEventLog() });

    expect(() => manager.subscribe("sess_unknown", () => undefined)).toThrow(
      SessionNotFoundError
    );
  });
});
