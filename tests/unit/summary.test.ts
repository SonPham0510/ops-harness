import { describe, expect, it } from "vitest";
import { summarize } from "@/core/observability/summary.js";
import type { SessionEvent } from "@/types/events.js";

const events: SessionEvent[] = [
  {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "sevt_created000000",
    objective: "Check checkout",
    seq: 1,
    sessionId: "sess_summary",
    type: "session.created",
  },
  {
    attempt: 1,
    createdAt: "2026-01-01T00:00:00.125Z",
    durationMs: 125,
    id: "sevt_model0000000",
    inputTokens: 100,
    outputTokens: 20,
    seq: 2,
    sessionId: "sess_summary",
    step: 1,
    stopReason: "tool_use",
    type: "span.model_request",
  },
  {
    createdAt: "2026-01-01T00:00:00.130Z",
    id: "sevt_use000000000",
    input: { service: "checkout" },
    name: "get_service_status",
    seq: 3,
    sessionId: "sess_summary",
    step: 1,
    toolUseId: "call_status",
    type: "agent.tool_use",
  },
  {
    attempt: 1,
    createdAt: "2026-01-01T00:00:00.160Z",
    durationMs: 30,
    id: "sevt_tool00000000",
    name: "get_service_status",
    outcome: "ok",
    seq: 4,
    sessionId: "sess_summary",
    step: 1,
    toolUseId: "call_status",
    type: "span.tool_attempt",
  },
  {
    createdAt: "2026-01-01T00:00:00.170Z",
    id: "sevt_approval00000",
    input: { title: "Checkout outage" },
    name: "create_incident",
    seq: 5,
    sessionId: "sess_summary",
    step: 2,
    toolUseId: "call_incident",
    type: "approval.requested",
  },
  {
    content: "denied",
    createdAt: "2026-01-01T00:00:00.200Z",
    id: "sevt_error0000000",
    isError: true,
    seq: 6,
    sessionId: "sess_summary",
    step: 2,
    toolUseId: "call_incident",
    type: "agent.tool_result",
  },
  {
    createdAt: "2026-01-01T00:00:00.250Z",
    from: "running",
    id: "sevt_status0000000",
    seq: 7,
    sessionId: "sess_summary",
    stopReason: "end_turn",
    to: "completed",
    type: "session.status",
  },
];

describe("summarize", () => {
  it("OBS-007: summarizes status, work, errors, approvals, tokens, and duration", () => {
    expect(summarize(events)).toEqual({
      approvals: 1,
      durationMs: 250,
      errors: 1,
      status: "completed",
      steps: 2,
      stopReason: "end_turn",
      tokens: { input: 100, output: 20 },
      toolCalls: 1,
    });
  });
});
