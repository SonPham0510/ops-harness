import { describe, expect, it } from "vitest";
import {
  canTransition,
  InvalidTransitionError,
  isTerminal,
  transition,
} from "@/core/session/state-machine.js";
import type { SessionStatus } from "@/types/session.js";

describe("session state machine", () => {
  it("SES-001: transitions from queued to running", () => {
    expect(transition("queued", "running")).toBe("running");
  });

  it("SES-001: rejects a transition out of a terminal state", () => {
    try {
      transition("completed", "running");
      throw new Error("Expected transition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(error).toMatchObject({
        from: "completed",
        to: "running",
      });
    }
  });

  it("SES-001: reports that paused cannot transition to requires_action", () => {
    expect(canTransition("paused", "requires_action")).toBe(false);
  });

  it.each<[SessionStatus, boolean]>([
    ["queued", false],
    ["running", false],
    ["paused", false],
    ["requires_action", false],
    ["completed", true],
    ["failed", true],
  ])("SES-002: classifies %s terminal status as %s", (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });
});
