import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { SessionEventSchema } from "@/types/events.js";

const SESSION_EVENT_ID_PATTERN = /^sevt_/;

describe("InMemoryEventLog", () => {
  it("EVT-001: assigns event ids, per-session sequence numbers, and timestamps", () => {
    const log = new InMemoryEventLog();

    const first = log.append("sess_a", {
      objective: "Check checkout",
      type: "session.created",
    });
    const second = log.append("sess_a", {
      from: "queued",
      to: "running",
      type: "session.status",
    });
    const otherSession = log.append("sess_b", {
      objective: "Check billing",
      type: "session.created",
    });

    expect(first.id).toMatch(SESSION_EVENT_ID_PATTERN);
    expect(first.createdAt).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
    expect([first.seq, second.seq, otherSession.seq]).toEqual([1, 2, 1]);
    expect(first.sessionId).toBe("sess_a");
  });

  it("EVT-001: accepts a non-empty modelId and rejects an empty one", () => {
    const log = new InMemoryEventLog();

    const event = log.append("sess_model", {
      modelId: "deepseek/deepseek-v4.1-flash",
      objective: "Check checkout",
      type: "session.created",
    });

    expect(event).toMatchObject({
      modelId: "deepseek/deepseek-v4.1-flash",
    });
    expect(() =>
      log.append("sess_empty_model", {
        modelId: "",
        objective: "Check checkout",
        type: "session.created",
      })
    ).toThrow();
  });

  it("EVT-001: rejects an event with an invalid payload", () => {
    const parsed = SessionEventSchema.safeParse({
      createdAt: "2026-09-28T00:00:00.000Z",
      id: "sevt_123",
      objective: "Check checkout",
      seq: 1,
      sessionId: "sess_a",
      type: "session.created",
      unexpected: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("EVT-003: keeps appended events immutable and exposes no update or delete API", () => {
    const log = new InMemoryEventLog();
    const event = {
      input: { service_name: "checkout" },
      name: "get_service_status",
      toolUseId: "call_1",
      type: "agent.tool_use" as const,
    };

    log.append("sess_a", event);
    event.input.service_name = "billing";

    expect(log.getEvents("sess_a")[0]).toMatchObject({
      input: { service_name: "checkout" },
    });
    expect("update" in log).toBe(false);
    expect("delete" in log).toBe(false);
  });

  it("EVT-002: returns events after a sequence number in ascending order", () => {
    const log = new InMemoryEventLog();
    log.append("sess_a", {
      objective: "Check checkout",
      type: "session.created",
    });
    log.append("sess_a", {
      from: "queued",
      to: "running",
      type: "session.status",
    });
    log.append("sess_a", {
      from: "running",
      to: "completed",
      type: "session.status",
    });

    expect(log.getEvents("sess_a").map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(log.getEvents("sess_a", 1).map(({ seq }) => seq)).toEqual([2, 3]);
    expect(log.getEvents("sess_unknown")).toEqual([]);
  });
});
