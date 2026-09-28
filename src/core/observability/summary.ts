import type { SessionEvent } from "@/types/events.js";
import type { SessionSnapshot } from "@/types/session.js";

export interface SessionSummary {
  approvals: number;
  durationMs: number;
  errors: number;
  status: SessionSnapshot["status"];
  steps: number;
  stopReason?: SessionSnapshot["stopReason"];
  tokens: { input: number; output: number };
  toolCalls: number;
}

interface SummaryAccumulator {
  approvals: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  status: SessionSummary["status"];
  steps: number;
  stopReason?: SessionSummary["stopReason"];
  toolCalls: number;
}

export const summarize = (events: readonly SessionEvent[]): SessionSummary => {
  const summary: SummaryAccumulator = {
    approvals: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    status: "queued",
    steps: 0,
    toolCalls: 0,
  };
  for (const event of events) {
    if (event.step !== undefined) {
      summary.steps = Math.max(summary.steps, event.step);
    }
    accumulate(summary, event);
  }
  const firstTimestamp = events[0]?.createdAt;
  const lastTimestamp = events.at(-1)?.createdAt;
  const durationMs =
    firstTimestamp && lastTimestamp
      ? Math.max(0, Date.parse(lastTimestamp) - Date.parse(firstTimestamp))
      : 0;
  return {
    approvals: summary.approvals,
    durationMs,
    errors: summary.errors,
    status: summary.status,
    steps: summary.steps,
    ...(summary.stopReason === undefined
      ? {}
      : { stopReason: summary.stopReason }),
    tokens: { input: summary.inputTokens, output: summary.outputTokens },
    toolCalls: summary.toolCalls,
  };
};

const accumulate = (summary: SummaryAccumulator, event: SessionEvent): void => {
  switch (event.type) {
    case "session.status": {
      summary.status = event.to;
      summary.stopReason = event.stopReason;
      break;
    }
    case "agent.tool_use": {
      summary.toolCalls += 1;
      break;
    }
    case "agent.tool_result": {
      if (event.isError) {
        summary.errors += 1;
      }
      break;
    }
    case "session.error": {
      summary.errors += 1;
      break;
    }
    case "approval.requested": {
      summary.approvals += 1;
      break;
    }
    case "span.model_request": {
      summary.inputTokens += event.inputTokens ?? 0;
      summary.outputTokens += event.outputTokens ?? 0;
      break;
    }
    default: {
      break;
    }
  }
};
