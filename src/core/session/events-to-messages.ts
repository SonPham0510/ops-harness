import type { ChatMessages, ChatToolCall } from "@openrouter/sdk/models";
import type { SessionEvent } from "@/types/events.js";

type AssistantEvent = Extract<
  SessionEvent,
  { type: "agent.message" | "agent.tool_use" }
>;
type AssistantMessage = Extract<ChatMessages, { role: "assistant" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRawToolCall = (value: unknown): boolean => {
  if (!(isRecord(value) && value.type === "function")) {
    return false;
  }
  const toolFunction = value.function;
  return (
    typeof value.id === "string" &&
    isRecord(toolFunction) &&
    typeof toolFunction.name === "string" &&
    typeof toolFunction.arguments === "string"
  );
};

const isRawAssistantMessage = (value: unknown): value is AssistantMessage => {
  if (!(isRecord(value) && value.role === "assistant")) {
    return false;
  }
  const hasValidContent =
    value.content === undefined ||
    value.content === null ||
    typeof value.content === "string" ||
    Array.isArray(value.content);
  const hasValidToolCalls =
    value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) && value.toolCalls.every(isRawToolCall));
  return hasValidContent && hasValidToolCalls;
};

const isAssistantEvent = (event: SessionEvent): event is AssistantEvent =>
  event.type === "agent.message" || event.type === "agent.tool_use";

const collectAssistantGroup = (
  events: readonly SessionEvent[],
  startIndex: number,
  first: AssistantEvent
): { assistantEvents: AssistantEvent[]; nextIndex: number } => {
  const assistantEvents: AssistantEvent[] = [];
  const { step } = first;
  let nextIndex = startIndex;

  while (nextIndex < events.length) {
    const candidate = events[nextIndex];
    if (
      !(candidate && isAssistantEvent(candidate)) ||
      candidate.step !== step
    ) {
      break;
    }
    assistantEvents.push(candidate);
    nextIndex += 1;
  }

  return { assistantEvents, nextIndex };
};

const projectAssistantMessage = (
  assistantEvents: readonly AssistantEvent[]
): ChatMessages => {
  const raw = assistantEvents.find(
    (candidate) => candidate.raw !== undefined
  )?.raw;
  if (isRawAssistantMessage(raw)) {
    return structuredClone(raw);
  }

  const content = assistantEvents
    .filter(
      (
        candidate
      ): candidate is Extract<SessionEvent, { type: "agent.message" }> =>
        candidate.type === "agent.message"
    )
    .map((candidate) => candidate.content)
    .join("");
  const toolCalls: ChatToolCall[] = assistantEvents
    .filter(
      (
        candidate
      ): candidate is Extract<SessionEvent, { type: "agent.tool_use" }> =>
        candidate.type === "agent.tool_use"
    )
    .map((candidate) => ({
      function: {
        arguments: JSON.stringify(candidate.input),
        name: candidate.name,
      },
      id: candidate.toolUseId,
      type: "function",
    }));

  return {
    content: content || null,
    role: "assistant",
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
};

export const eventsToMessages = (
  events: readonly SessionEvent[]
): ChatMessages[] => {
  const messages: ChatMessages[] = [];
  let index = 0;

  while (index < events.length) {
    const event = events[index];
    if (!event) {
      break;
    }

    if (event.type === "user.message" || event.type === "harness.correction") {
      messages.push({ content: event.content, role: "user" });
      index += 1;
      continue;
    }

    if (isAssistantEvent(event)) {
      const { assistantEvents, nextIndex } = collectAssistantGroup(
        events,
        index,
        event
      );
      messages.push(projectAssistantMessage(assistantEvents));
      index = nextIndex;
      continue;
    }

    if (event.type === "agent.tool_result") {
      messages.push({
        content: event.isError
          ? JSON.stringify({ error: true, message: event.content })
          : event.content,
        role: "tool",
        toolCallId: event.toolUseId,
      });
    }

    index += 1;
  }

  return messages;
};
