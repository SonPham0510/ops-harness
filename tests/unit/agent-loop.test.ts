import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { AgentLoop } from "@/core/loop/agent-loop.js";
import { ToolError } from "@/core/tools/errors.js";
import { defineTool, ToolRegistry } from "@/core/tools/registry.js";
import { ModelError, ModelProtocolError } from "@/model/model.js";
import { ScriptedModel } from "@/model/scripted.js";
import type { SessionEvent } from "@/types/events.js";
import type { SessionStopReason } from "@/types/session.js";

describe("AgentLoop", () => {
  it("LOOP-001 + LOOP-002: sends session context and ends on text-only end_turn", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_text";
    eventLog.append(sessionId, {
      modelId: "openrouter/test-model",
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      { stopReason: "end_turn", text: "Checkout is healthy.", toolCalls: [] },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Retrieve service status",
        handler: () => Promise.resolve({ status: "operational" }),
        input: z.object({ service_name: z.string() }),
        name: "get_service_status",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const stopCalls: Array<{
      detail: unknown;
      reason: SessionStopReason;
    }> = [];
    const loop = new AgentLoop({ model, registry });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      modelId: "openrouter/test-model",
      objective: "Check checkout health",
      onStop: (reason, detail) => stopCalls.push({ detail, reason }),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      content: "Checkout is healthy.",
      step: 1,
      type: "agent.message",
    });
    expect(stopCalls).toEqual([{ detail: undefined, reason: "end_turn" }]);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]).toMatchObject({
      modelId: "openrouter/test-model",
      tools: [
        {
          function: {
            name: "get_service_status",
          },
          type: "function",
        },
      ],
    });
    expect(model.requests[0]?.messages).toContainEqual({
      content: "Check checkout health",
      role: "user",
    });
  });

  it("LOOP-003 + LOOP-004: tool-only response runs tool, feeds result back, then answers", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_tool";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const raw = {
      content: null,
      role: "assistant",
      toolCalls: [
        {
          function: {
            arguments: '{"service_name":"checkout"}',
            name: "get_service_status",
          },
          id: "call_status",
          type: "function",
        },
      ],
    };
    const model = new ScriptedModel([
      {
        raw,
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_status",
            input: { service_name: "checkout" },
            name: "get_service_status",
          },
        ],
      },
      {
        stopReason: "end_turn",
        text: "Checkout is operational.",
        toolCalls: [],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Retrieve service status",
        handler: () => Promise.resolve({ status: "operational" }),
        input: z.object({ service_name: z.string() }),
        name: "get_service_status",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const loop = new AgentLoop({ model, registry });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: () => {
        // This case asserts emitted events only.
      },
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      {
        input: { service_name: "checkout" },
        name: "get_service_status",
        raw,
        step: 1,
        toolUseId: "call_status",
        type: "agent.tool_use",
      },
      {
        content: '{"status":"operational"}',
        isError: false,
        step: 1,
        toolUseId: "call_status",
        type: "agent.tool_result",
      },
      {
        content: "Checkout is operational.",
        step: 2,
        type: "agent.message",
      },
    ]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages).toContainEqual({
      content: '{"status":"operational"}',
      role: "tool",
      toolCallId: "call_status",
    });
  });

  it("LOOP-003: text-and-tool response stores raw on its message", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_text_tool";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const raw = { content: "Checking now.", role: "assistant" };
    const model = new ScriptedModel([
      {
        raw,
        stopReason: "tool_use",
        text: "Checking now.",
        toolCalls: [
          {
            id: "call_status",
            input: { service_name: "checkout" },
            name: "get_service_status",
          },
        ],
      },
      { stopReason: "end_turn", text: "All clear.", toolCalls: [] },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Retrieve service status",
        handler: () => Promise.resolve({ status: "operational" }),
        input: z.object({ service_name: z.string() }),
        name: "get_service_status",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const loop = new AgentLoop({ model, registry });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: () => {
        // This case asserts raw-event placement only.
      },
      sessionId,
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      content: "Checking now.",
      raw,
      step: 1,
      type: "agent.message",
    });
    expect(events[1]).toMatchObject({
      step: 1,
      toolUseId: "call_status",
      type: "agent.tool_use",
    });
    expect(events[1]).not.toHaveProperty("raw");
  });

  it("LOOP-005: tool error is returned as isError result and loop continues", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_tool_error";
    eventLog.append(sessionId, {
      objective: "Check missing service",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_missing",
            input: { service_name: "missing" },
            name: "get_service_status",
          },
        ],
      },
      {
        stopReason: "end_turn",
        text: "The service was not found.",
        toolCalls: [],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Retrieve service status",
        handler: () => {
          throw new ToolError("not_found", "Unknown service", false);
        },
        input: z.object({ service_name: z.string() }),
        name: "get_service_status",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const loop = new AgentLoop({ model, registry });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Check missing service",
      onStop: () => {
        // This case asserts that tool failure does not stop the loop.
      },
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      {
        toolUseId: "call_missing",
        type: "agent.tool_use",
      },
      {
        content: "Unknown service",
        isError: true,
        toolUseId: "call_missing",
        type: "agent.tool_result",
      },
      {
        content: "The service was not found.",
        type: "agent.message",
      },
    ]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages).toContainEqual({
      content: JSON.stringify({ error: true, message: "Unknown service" }),
      role: "tool",
      toolCallId: "call_missing",
    });
  });

  it("OBS-003: retryable tool errors emit one span per attempt", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_tool_attempt_spans";
    let calls = 0;
    eventLog.append(sessionId, {
      objective: "Look up checkout",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_lookup", input: {}, name: "lookup" }],
      },
      { stopReason: "end_turn", text: "Done.", toolCalls: [] },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Lookup data",
        handler: () => {
          calls += 1;
          if (calls === 1) {
            throw new ToolError("upstream_unavailable", "try again", true);
          }
          return Promise.resolve({ ok: true });
        },
        input: z.object({}),
        name: "lookup",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const loop = new AgentLoop({
      baseDelayMs: 1,
      model,
      random: () => 0.5,
      registry,
      sleep: () => Promise.resolve(),
    });

    for await (const _event of loop.execute({
      eventLog,
      objective: "Look up checkout",
      onStop: () => undefined,
      sessionId,
    })) {
      // Inspect spans through the event log.
    }

    expect(
      eventLog
        .getEvents(sessionId)
        .filter((event) => event.type === "span.tool_attempt")
    ).toMatchObject([
      {
        attempt: 1,
        name: "lookup",
        outcome: "upstream_unavailable",
        toolUseId: "call_lookup",
      },
      { attempt: 2, name: "lookup", outcome: "ok", toolUseId: "call_lookup" },
    ]);
  });

  it.each([
    [
      "ModelProtocolError",
      () => Promise.reject(new ModelProtocolError("bad wire")),
    ],
    ["schema-invalid response", { not: "a model response" }],
    ["empty response", { stopReason: "end_turn", text: "", toolCalls: [] }],
    [
      "max_tokens response",
      { stopReason: "max_tokens", text: "partial", toolCalls: [] },
    ],
    [
      "duplicate tool call IDs",
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          { id: "call_duplicate", input: {}, name: "one" },
          { id: "call_duplicate", input: {}, name: "two" },
        ],
      },
    ],
    [
      "tool_use without calls",
      { stopReason: "tool_use", text: "", toolCalls: [] },
    ],
    [
      "tool calls with end_turn",
      {
        stopReason: "end_turn",
        text: "",
        toolCalls: [{ id: "call_mismatch", input: {}, name: "one" }],
      },
    ],
  ])(
    "LOOP-010: malformed %s emits correction and recovers",
    async (_name, malformed) => {
      const eventLog = new InMemoryEventLog();
      const sessionId = "sess_loop_malformed";
      eventLog.append(sessionId, {
        objective: "Check checkout health",
        type: "session.created",
      });
      const model = new ScriptedModel([
        malformed as never,
        { stopReason: "end_turn", text: "Recovered response.", toolCalls: [] },
      ]);
      const loop = new AgentLoop({ model, registry: new ToolRegistry([]) });
      const events: SessionEvent[] = [];

      for await (const event of loop.execute({
        eventLog,
        objective: "Check checkout health",
        onStop: () => {
          // This case asserts malformed response recovery.
        },
        sessionId,
      })) {
        events.push(event);
      }

      expect(events).toMatchObject([
        { step: 1, type: "harness.malformed_response" },
        { step: 1, type: "harness.correction" },
        { content: "Recovered response.", step: 2, type: "agent.message" },
      ]);
      expect(events).not.toContainEqual(
        expect.objectContaining({ content: "partial", type: "agent.message" })
      );
      expect(model.requests[1]?.messages).toContainEqual(
        expect.objectContaining({ role: "user" })
      );
    }
  );

  it("LOOP-011: exceeding maxMalformedResponses stops with malformed_response", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_malformed_limit";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      { stopReason: "max_tokens", text: "partial one", toolCalls: [] },
      { stopReason: "max_tokens", text: "partial two", toolCalls: [] },
      { stopReason: "end_turn", text: "Must not be called.", toolCalls: [] },
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxMalformedResponses: 1 },
      model,
      registry: new ToolRegistry([]),
    });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events.map(({ type }) => type)).toEqual([
      "harness.malformed_response",
      "harness.correction",
      "harness.malformed_response",
    ]);
    expect(stopCalls).toEqual(["malformed_response"]);
    expect(model.requests).toHaveLength(2);
  });

  it("LOOP-012: refusal stops with refusal", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_refusal";
    eventLog.append(sessionId, {
      objective: "Do something unsafe",
      type: "session.created",
    });
    const model = new ScriptedModel([
      { stopReason: "refusal", text: "I cannot do that.", toolCalls: [] },
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({ model, registry: new ToolRegistry([]) });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Do something unsafe",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(stopCalls).toEqual(["refusal"]);
    expect(model.requests).toHaveLength(1);
  });

  it("LOOP-007 + OBS-002: retryable ModelError emits a span per attempt and recovers", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_model_retry";
    const delays: number[] = [];
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      { throw: new ModelError("temporarily unavailable", true) },
      { stopReason: "end_turn", text: "Recovered.", toolCalls: [] },
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      baseDelayMs: 10,
      model,
      random: () => 0.5,
      registry: new ToolRegistry([]),
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { content: "Recovered.", type: "agent.message" },
    ]);
    expect(delays).toEqual([10]);
    expect(model.requests).toHaveLength(2);
    expect(stopCalls).toEqual(["end_turn"]);
    expect(
      eventLog
        .getEvents(sessionId)
        .filter((event) => event.type === "span.model_request")
    ).toMatchObject([
      { attempt: 1, error: { retryable: true } },
      { attempt: 2, stopReason: "end_turn" },
    ]);
  });

  it.each([
    ["non-retryable", [new ModelError("bad request", false)]],
    [
      "exhausted retries",
      [
        new ModelError("upstream unavailable", true),
        new ModelError("upstream unavailable", true),
      ],
    ],
  ])("LOOP-008: %s ModelError stops with llm_error", async (_name, errors) => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_model_error";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel(errors.map((error) => ({ throw: error })));
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { modelMaxRetries: 1 },
      model,
      registry: new ToolRegistry([]),
      sleep: () => Promise.resolve(),
    });

    const events: SessionEvent[] = [];
    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(stopCalls).toEqual(["llm_error"]);
    expect(model.requests).toHaveLength(errors.length);
  });

  it("LIM-001: stops at maxSteps before calling model again", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_step_limit";
    let handlerCalls = 0;
    eventLog.append(sessionId, {
      objective: "Keep checking",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_1", input: { value: 1 }, name: "counter" }],
      },
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_2", input: { value: 2 }, name: "counter" }],
      },
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_3", input: { value: 3 }, name: "counter" }],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Counts calls",
        handler: ({ value }) => {
          handlerCalls += 1;
          return Promise.resolve({ value });
        },
        input: z.object({ value: z.number() }),
        name: "counter",
        output: z.object({ value: z.number() }),
      }),
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxSteps: 2 },
      model,
      registry,
    });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Keep checking",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(model.requests).toHaveLength(2);
    expect(handlerCalls).toBe(2);
    expect(events.at(-1)).toMatchObject({
      limit: "max_steps",
      type: "harness.limit_hit",
    });
    expect(stopCalls).toEqual(["max_steps"]);
  });

  it("LIM-004: maxToolCalls stops before executing an overflowing batch", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_tool_limit";
    let handlerCalls = 0;
    eventLog.append(sessionId, {
      objective: "Keep checking",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_1", input: {}, name: "counter" }],
      },
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_2", input: {}, name: "counter" }],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Counts calls",
        handler: () => {
          handlerCalls += 1;
          return Promise.resolve({ ok: true });
        },
        input: z.object({}),
        name: "counter",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxToolCalls: 1 },
      model,
      registry,
    });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Keep checking",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(model.requests).toHaveLength(2);
    expect(handlerCalls).toBe(1);
    expect(
      events.filter((event) => event.type === "agent.tool_use")
    ).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      limit: "max_tool_calls",
      type: "harness.limit_hit",
    });
    expect(stopCalls).toEqual(["max_steps"]);
  });

  it("LIM-002: deadline aborts a hanging model and stops with timeout", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_deadline";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new Error("model request aborted")),
            { once: true }
          );
        }),
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxRunMs: 20, modelTimeoutMs: 100 },
      model,
      registry: new ToolRegistry([]),
    });

    const events: SessionEvent[] = [];
    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(stopCalls).toEqual(["timeout"]);
    expect(model.requests).toHaveLength(1);
  }, 500);

  it("LOOP-009: a per-call model timeout is retried and can recover", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_model_timeout";
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new ModelError("model request timed out", true)),
            { once: true }
          );
        }),
      {
        stopReason: "end_turn",
        text: "Recovered after timeout.",
        toolCalls: [],
      },
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxRunMs: 100, modelMaxRetries: 1, modelTimeoutMs: 20 },
      model,
      registry: new ToolRegistry([]),
      sleep: () => Promise.resolve(),
    });

    const events: SessionEvent[] = [];
    for await (const event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { content: "Recovered after timeout.", type: "agent.message" },
    ]);
    expect(model.requests).toHaveLength(2);
    expect(stopCalls).toEqual(["end_turn"]);
  }, 500);

  it("LIM-003: repeated equivalent tool calls stop before the last call executes", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_guard";
    let handlerCalls = 0;
    eventLog.append(sessionId, {
      objective: "Keep checking checkout",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_first",
            input: { region: "us-east-1", service: "checkout" },
            name: "check_service",
          },
        ],
      },
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_repeat",
            input: { region: "us-east-1", service: "checkout" },
            name: "check_service",
          },
        ],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Checks a service",
        handler: () => {
          handlerCalls += 1;
          return Promise.resolve({ status: "operational" });
        },
        input: z.object({ region: z.string(), service: z.string() }),
        name: "check_service",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({
      limits: { maxIdenticalToolCalls: 1 },
      model,
      registry,
    });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Keep checking checkout",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
    })) {
      events.push(event);
    }

    expect(handlerCalls).toBe(1);
    expect(model.requests).toHaveLength(2);
    expect(
      events.filter((event) => event.type === "agent.tool_use")
    ).toHaveLength(1);
    expect(stopCalls).toEqual(["loop_detected"]);
  });

  it("LIM-005: external interrupt aborts a running tool and stops the loop", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_interrupt";
    const controller = new AbortController();
    let toolWasAborted = false;
    eventLog.append(sessionId, {
      objective: "Check checkout health",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "call_status", input: {}, name: "check_service" }],
      },
      { stopReason: "end_turn", text: "Must not be called.", toolCalls: [] },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Checks a service",
        handler: (_input, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                toolWasAborted = true;
                reject(new Error("tool aborted"));
              },
              { once: true }
            );
          }),
        input: z.object({}),
        name: "check_service",
        output: z.object({ status: z.string() }),
      }),
    ]);
    const stopCalls: SessionStopReason[] = [];
    const loop = new AgentLoop({ model, registry });

    setTimeout(() => controller.abort(), 20);
    for await (const _event of loop.execute({
      eventLog,
      objective: "Check checkout health",
      onStop: (reason) => stopCalls.push(reason),
      sessionId,
      signal: controller.signal,
    })) {
      // The stop reason and handler signal are the observable contract here.
    }

    expect(toolWasAborted).toBe(true);
    expect(model.requests).toHaveLength(1);
    expect(stopCalls).toEqual(["interrupted"]);
  });

  it("LOOP-006: approval defers every tool result and handler in its step", async () => {
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_loop_approval";
    let safeHandlerCalls = 0;
    let approvalHandlerCalls = 0;
    eventLog.append(sessionId, {
      objective: "Investigate checkout outage",
      type: "session.created",
    });
    const model = new ScriptedModel([
      {
        stopReason: "tool_use",
        text: "Investigating.",
        toolCalls: [
          { id: "call_bad", input: {}, name: "safe_lookup" },
          {
            id: "call_safe",
            input: { service: "checkout" },
            name: "safe_lookup",
          },
          {
            id: "call_incident",
            input: { title: "Checkout outage" },
            name: "create_incident",
          },
        ],
      },
    ]);
    const registry = new ToolRegistry([
      defineTool({
        description: "Looks up a service",
        handler: () => {
          safeHandlerCalls += 1;
          return Promise.resolve({ status: "operational" });
        },
        input: z.object({ service: z.string() }),
        name: "safe_lookup",
        output: z.object({ status: z.string() }),
      }),
      defineTool({
        description: "Creates an incident",
        handler: () => {
          approvalHandlerCalls += 1;
          return Promise.resolve({ id: "inc_1" });
        },
        input: z.object({ title: z.string() }),
        name: "create_incident",
        output: z.object({ id: z.string() }),
        requiresApproval: true,
      }),
    ]);
    const stopCalls: Array<{ detail: unknown; reason: SessionStopReason }> = [];
    const loop = new AgentLoop({ model, registry });
    const events: SessionEvent[] = [];

    for await (const event of loop.execute({
      eventLog,
      objective: "Investigate checkout outage",
      onStop: (reason, detail) => stopCalls.push({ detail, reason }),
      sessionId,
    })) {
      events.push(event);
    }

    expect(safeHandlerCalls).toBe(0);
    expect(approvalHandlerCalls).toBe(0);
    expect(
      events.filter((event) => event.type === "agent.tool_result")
    ).toEqual([]);
    expect(
      events.filter((event) => event.type === "agent.tool_use")
    ).toHaveLength(3);
    expect(stopCalls).toEqual([
      {
        detail: expect.objectContaining({
          pendingToolUseIds: ["call_incident"],
          step: 1,
        }),
        reason: "tool_confirmation",
      },
    ]);
  });
});
