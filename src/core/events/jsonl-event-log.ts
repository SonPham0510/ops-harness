import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { EventLog } from "@/core/events/event-log.js";
import { materializeSessionEvent } from "@/core/events/event-log.js";
import type { NewSessionEvent, SessionEvent } from "@/types/events.js";
import { SessionEventSchema } from "@/types/events.js";

const JSONL_SUFFIX = ".jsonl";

export class InvalidEventLogError extends Error {
  readonly filePath: string;

  constructor(filePath: string, options?: ErrorOptions) {
    super(`Invalid event log: ${filePath}`, options);
    this.name = "InvalidEventLogError";
    this.filePath = filePath;
  }
}

export class JsonlEventLog implements EventLog {
  readonly #cache = new Map<string, SessionEvent[]>();
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  append(sessionId: string, event: NewSessionEvent): SessionEvent {
    const events = this.#load(sessionId);
    const stored = materializeSessionEvent(
      sessionId,
      event,
      (events.at(-1)?.seq ?? 0) + 1
    );
    appendFileSync(
      this.#pathFor(sessionId),
      `${JSON.stringify(stored)}\n`,
      "utf8"
    );
    events.push(stored);
    return structuredClone(stored);
  }

  getEvents(sessionId: string, afterSeq = 0): SessionEvent[] {
    return structuredClone(
      this.#load(sessionId).filter(({ seq }) => seq > afterSeq)
    );
  }

  latestSeq(sessionId: string): number {
    return this.#load(sessionId).at(-1)?.seq ?? 0;
  }

  listSessionIds(): string[] {
    return readdirSync(this.#directory)
      .filter((name) => name.endsWith(JSONL_SUFFIX))
      .map((name) => basename(name, JSONL_SUFFIX))
      .sort();
  }

  #load(sessionId: string): SessionEvent[] {
    const cached = this.#cache.get(sessionId);
    if (cached) {
      return cached;
    }

    const filePath = this.#pathFor(sessionId);
    if (!existsSync(filePath)) {
      const empty: SessionEvent[] = [];
      this.#cache.set(sessionId, empty);
      return empty;
    }

    try {
      const content = readFileSync(filePath, "utf8").trim();
      const events = content
        ? content
            .split("\n")
            .map((line) => SessionEventSchema.parse(JSON.parse(line)))
        : [];
      this.#cache.set(sessionId, events);
      return events;
    } catch (error) {
      throw new InvalidEventLogError(filePath, { cause: error });
    }
  }

  #pathFor(sessionId: string): string {
    return join(this.#directory, `${sessionId}${JSONL_SUFFIX}`);
  }
}
