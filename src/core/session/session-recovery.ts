import type { SessionEvent } from "@/types/events.js";

type ToolUseEvent = Extract<SessionEvent, { type: "agent.tool_use" }>;

export const findOrphanedToolUses = (
  events: readonly SessionEvent[]
): ToolUseEvent[] => {
  const completedToolUseIds = new Set(
    events
      .filter(
        (
          event
        ): event is Extract<SessionEvent, { type: "agent.tool_result" }> =>
          event.type === "agent.tool_result"
      )
      .map(({ toolUseId }) => toolUseId)
  );

  return events.filter(
    (event): event is ToolUseEvent =>
      event.type === "agent.tool_use" &&
      !completedToolUseIds.has(event.toolUseId)
  );
};
