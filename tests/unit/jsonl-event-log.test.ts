import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidEventLogError,
  JsonlEventLog,
} from "@/core/events/jsonl-event-log.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "ops-agent-event-log-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("JsonlEventLog", () => {
  it("EVT-004: persists events, reopens them, and continues sequence numbers", () => {
    const directory = makeTemporaryDirectory();
    const log = new JsonlEventLog(directory);
    log.append("sess_persisted", {
      objective: "Check checkout",
      type: "session.created",
    });
    log.append("sess_persisted", {
      content: "Investigate checkout",
      type: "user.message",
    });

    const lines = readFileSync(join(directory, "sess_persisted.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines.map(({ seq }) => seq)).toEqual([1, 2]);

    const reopened = new JsonlEventLog(directory);
    expect(reopened.getEvents("sess_persisted")).toMatchObject([
      { objective: "Check checkout", seq: 1, type: "session.created" },
      { content: "Investigate checkout", seq: 2, type: "user.message" },
    ]);
    expect(
      reopened.append("sess_persisted", {
        from: "queued",
        to: "running",
        type: "session.status",
      }).seq
    ).toBe(3);
    expect(reopened.listSessionIds()).toEqual(["sess_persisted"]);
  });

  it("EVT-004: rejects a JSONL line that is not a valid event", () => {
    const directory = makeTemporaryDirectory();
    writeFileSync(join(directory, "sess_broken.jsonl"), '{"broken":true}\n');

    const log = new JsonlEventLog(directory);

    expect(() => log.getEvents("sess_broken")).toThrow(InvalidEventLogError);
  });
});
