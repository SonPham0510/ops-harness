import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { eventsToMessages } from "@/core/session/events-to-messages.js";

describe("eventsToMessages", () => {
  it("EVT-005: projects user, grouped assistant tool calls, and individual tool results", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      content: "hi",
      type: "user.message",
    });
    log.append("sess_a", {
      content: "checking",
      step: 1,
      type: "agent.message",
    });
    log.append("sess_a", {
      input: { service_name: "checkout" },
      name: "get_service_status",
      step: 1,
      toolUseId: "call_a",
      type: "agent.tool_use",
    });
    log.append("sess_a", {
      input: { query: "checkout latency" },
      name: "search_knowledge_base",
      step: 1,
      toolUseId: "call_b",
      type: "agent.tool_use",
    });
    log.append("sess_a", {
      content: '{"status":"degraded"}',
      isError: false,
      step: 1,
      toolUseId: "call_a",
      type: "agent.tool_result",
    });
    log.append("sess_a", {
      content: "knowledge base timed out",
      isError: true,
      step: 1,
      toolUseId: "call_b",
      type: "agent.tool_result",
    });

    expect(eventsToMessages(log.getEvents("sess_a"))).toEqual([
      { content: "hi", role: "user" },
      {
        content: "checking",
        role: "assistant",
        toolCalls: [
          {
            function: {
              arguments: '{"service_name":"checkout"}',
              name: "get_service_status",
            },
            id: "call_a",
            type: "function",
          },
          {
            function: {
              arguments: '{"query":"checkout latency"}',
              name: "search_knowledge_base",
            },
            id: "call_b",
            type: "function",
          },
        ],
      },
      {
        content: '{"status":"degraded"}',
        role: "tool",
        toolCallId: "call_a",
      },
      {
        content: '{"error":true,"message":"knowledge base timed out"}',
        role: "tool",
        toolCallId: "call_b",
      },
    ]);
  });

  it("EVT-005: reuses one raw assistant message without duplicating tool calls", () => {
    const withText = new InMemoryEventLog();
    const textRaw = {
      content: "checking",
      reasoning: "provider reasoning token",
      role: "assistant" as const,
      toolCalls: [
        {
          function: {
            arguments: '{"service_name":"checkout"}',
            name: "get_service_status",
          },
          id: "call_text",
          type: "function" as const,
        },
      ],
    };
    withText.append("sess_text", {
      content: "checking",
      raw: textRaw,
      step: 1,
      type: "agent.message",
    });
    withText.append("sess_text", {
      input: { service_name: "checkout" },
      name: "get_service_status",
      step: 1,
      toolUseId: "call_text",
      type: "agent.tool_use",
    });

    const toolOnly = new InMemoryEventLog();
    const toolOnlyRaw = {
      content: null,
      role: "assistant" as const,
      toolCalls: [
        {
          function: {
            arguments: '{"query":"checkout"}',
            name: "search_knowledge_base",
          },
          id: "call_only",
          type: "function" as const,
        },
      ],
    };
    toolOnly.append("sess_tool_only", {
      input: { query: "checkout" },
      name: "search_knowledge_base",
      raw: toolOnlyRaw,
      step: 1,
      toolUseId: "call_only",
      type: "agent.tool_use",
    });

    expect(eventsToMessages(withText.getEvents("sess_text"))).toEqual([
      textRaw,
    ]);
    expect(eventsToMessages(toolOnly.getEvents("sess_tool_only"))).toEqual([
      toolOnlyRaw,
    ]);
  });

  it("EVT-005: projects a malformed-response correction as a user message", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      content: "Return either text or a valid tool call.",
      step: 2,
      type: "harness.correction",
    });

    expect(eventsToMessages(log.getEvents("sess_a"))).toEqual([
      {
        content: "Return either text or a valid tool call.",
        role: "user",
      },
    ]);
  });

  it("EVT-005: ignores session, span, limit, and confirmation metadata", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      content: "hi",
      type: "user.message",
    });
    log.append("sess_a", {
      from: "queued",
      to: "running",
      type: "session.status",
    });
    log.append("sess_a", {
      attempt: 1,
      durationMs: 12,
      inputTokens: 10,
      outputTokens: 5,
      step: 1,
      stopReason: "end_turn",
      type: "span.model_request",
    });
    log.append("sess_a", {
      limit: "max_steps",
      type: "harness.limit_hit",
    });
    log.append("sess_a", {
      result: "allow",
      toolUseId: "call_a",
      type: "user.tool_confirmation",
    });

    expect(eventsToMessages(log.getEvents("sess_a"))).toEqual([
      { content: "hi", role: "user" },
    ]);
  });
});
