import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import {
  InvalidSessionHistoryError,
  projectSession,
} from "@/core/session/project-session.js";

describe("projectSession", () => {
  it("EVT-007: derives model, status, pending approvals, stop reason, and final answer", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      modelId: "deepseek/deepseek-v4.1-flash",
      objective: "Check checkout",
      type: "session.created",
    });
    log.append("sess_a", {
      from: "queued",
      to: "running",
      type: "session.status",
    });
    log.append("sess_a", {
      input: { severity: "high" },
      name: "create_incident",
      step: 1,
      toolUseId: "call_a",
      type: "approval.requested",
    });
    log.append("sess_a", {
      input: { severity: "medium" },
      name: "create_incident",
      step: 1,
      toolUseId: "call_b",
      type: "approval.requested",
    });
    log.append("sess_a", {
      from: "running",
      stopReason: "tool_confirmation",
      to: "requires_action",
      type: "session.status",
    });
    log.append("sess_a", {
      result: "allow",
      toolUseId: "call_a",
      type: "approval.decided",
    });

    expect(projectSession(log.getEvents("sess_a"))).toMatchObject({
      id: "sess_a",
      modelId: "deepseek/deepseek-v4.1-flash",
      objective: "Check checkout",
      pendingToolUseIds: ["call_b"],
      status: "requires_action",
      stopReason: "tool_confirmation",
    });

    log.append("sess_a", {
      result: "deny",
      toolUseId: "call_b",
      type: "approval.decided",
    });
    log.append("sess_a", {
      from: "requires_action",
      to: "running",
      type: "session.status",
    });
    log.append("sess_a", {
      content: "Checkout is degraded; incident creation was denied.",
      step: 2,
      type: "agent.message",
    });
    log.append("sess_a", {
      from: "running",
      stopReason: "end_turn",
      to: "completed",
      type: "session.status",
    });

    expect(projectSession(log.getEvents("sess_a"))).toEqual({
      finalAnswer: "Checkout is degraded; incident creation was denied.",
      id: "sess_a",
      modelId: "deepseek/deepseek-v4.1-flash",
      objective: "Check checkout",
      pendingToolUseIds: [],
      status: "completed",
      stopReason: "end_turn",
    });
  });

  it("EVT-007: rejects a history without session.created", () => {
    try {
      projectSession([]);
      throw new Error("Expected projectSession to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSessionHistoryError);
    }
  });
});
