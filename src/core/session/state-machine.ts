import type { SessionStatus } from "@/types/session.js";

export const SESSION_TRANSITIONS = {
  completed: [],
  failed: [],
  paused: ["running", "completed", "failed"],
  queued: ["running", "completed", "failed"],
  requires_action: ["running", "completed", "failed"],
  running: ["paused", "requires_action", "completed", "failed"],
} as const satisfies Record<SessionStatus, readonly SessionStatus[]>;

export class InvalidTransitionError extends Error {
  readonly from: SessionStatus;
  readonly to: SessionStatus;

  constructor(from: SessionStatus, to: SessionStatus) {
    super(`Invalid session transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export const transition = (
  from: SessionStatus,
  to: SessionStatus
): SessionStatus => {
  if (canTransition(from, to)) {
    return to;
  }

  throw new InvalidTransitionError(from, to);
};

export const canTransition = (
  from: SessionStatus,
  to: SessionStatus
): boolean => SESSION_TRANSITIONS[from].some((candidate) => candidate === to);

export const isTerminal = (status: SessionStatus): boolean =>
  status === "completed" || status === "failed";
