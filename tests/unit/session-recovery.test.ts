import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { findOrphanedToolUses } from "@/core/session/session-recovery.js";

describe("findOrphanedToolUses", () => {
  it("EVT-006: returns tool uses that have no matching result", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      input: { service_name: "checkout" },
      name: "get_service_status",
      step: 1,
      toolUseId: "call_a",
      type: "agent.tool_use",
    });
    log.append("sess_a", {
      input: { query: "checkout" },
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

    expect(
      findOrphanedToolUses(log.getEvents("sess_a")).map(
        ({ toolUseId }) => toolUseId
      )
    ).toEqual(["call_b"]);
    expect(findOrphanedToolUses([])).toEqual([]);
  });
});
