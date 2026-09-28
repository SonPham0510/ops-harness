export type SessionStatus =
  | "queued"
  | "running"
  | "paused"
  | "requires_action"
  | "completed"
  | "failed";

export type SessionStopReason =
  | "end_turn"
  | "max_steps"
  | "timeout"
  | "loop_detected"
  | "malformed_response"
  | "llm_error"
  | "refusal"
  | "tool_confirmation"
  | "interrupted";

export interface SessionSnapshot {
  finalAnswer?: string;
  id: string;
  modelId?: string;
  objective: string;
  pendingToolUseIds: string[];
  status: SessionStatus;
  stopReason?: SessionStopReason;
}
