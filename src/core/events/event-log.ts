import { nanoid } from "nanoid";
import {
  type NewSessionEvent,
  NewSessionEventSchema,
  type SessionEvent,
  SessionEventSchema,
} from "@/types/events.js";

export interface EventLog {
  append: (sessionId: string, event: NewSessionEvent) => SessionEvent;
  getEvents: (sessionId: string, afterSeq?: number) => SessionEvent[];
  latestSeq: (sessionId: string) => number;
  listSessionIds?: () => string[];
}

export const materializeSessionEvent = (
  sessionId: string,
  event: NewSessionEvent,
  seq: number
): SessionEvent => {
  const payload = NewSessionEventSchema.parse(event);
  return SessionEventSchema.parse({
    ...payload,
    createdAt: new Date().toISOString(),
    id: `sevt_${nanoid(16)}`,
    seq,
    sessionId,
  });
};

export class InMemoryEventLog implements EventLog {
  readonly #events = new Map<string, SessionEvent[]>();

  append(sessionId: string, event: NewSessionEvent): SessionEvent {
    const stored = materializeSessionEvent(
      sessionId,
      event,
      this.latestSeq(sessionId) + 1
    );
    const sessionEvents = this.#events.get(sessionId) ?? [];
    sessionEvents.push(stored);
    this.#events.set(sessionId, sessionEvents);
    return structuredClone(stored);
  }

  getEvents(sessionId: string, afterSeq = 0): SessionEvent[] {
    const events = this.#events.get(sessionId) ?? [];
    return structuredClone(events.filter(({ seq }) => seq > afterSeq));
  }

  latestSeq(sessionId: string): number {
    return this.#events.get(sessionId)?.at(-1)?.seq ?? 0;
  }
}
