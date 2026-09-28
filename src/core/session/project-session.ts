import type { SessionEvent } from "@/types/events.js";
import type { SessionSnapshot } from "@/types/session.js";

export class InvalidSessionHistoryError extends Error {
  constructor() {
    super("Session history is missing session.created");
    this.name = "InvalidSessionHistoryError";
  }
}

export const projectSession = (
  events: readonly SessionEvent[]
): SessionSnapshot => {
  const created = events.find((event) => event.type === "session.created");
  if (!created) {
    throw new InvalidSessionHistoryError();
  }

  let status: SessionSnapshot["status"] = "queued";
  let stopReason: SessionSnapshot["stopReason"];
  let finalAnswer: string | undefined;
  const requestedToolUseIds: string[] = [];
  const resolvedToolUseIds = new Set<string>();

  for (const event of events) {
    if (event.type === "session.status") {
      const { stopReason: eventStopReason, to } = event;
      status = to;
      stopReason = eventStopReason;
    } else if (event.type === "approval.requested") {
      requestedToolUseIds.push(event.toolUseId);
    } else if (
      event.type === "approval.decided" ||
      event.type === "agent.tool_result"
    ) {
      resolvedToolUseIds.add(event.toolUseId);
    } else if (event.type === "agent.message") {
      finalAnswer = event.content;
    }
  }

  return {
    id: created.sessionId,
    objective: created.objective,
    pendingToolUseIds: requestedToolUseIds.filter(
      (toolUseId) => !resolvedToolUseIds.has(toolUseId)
    ),
    status,
    ...(created.modelId ? { modelId: created.modelId } : {}),
    ...(finalAnswer ? { finalAnswer } : {}),
    ...(stopReason ? { stopReason } : {}),
  };
};
