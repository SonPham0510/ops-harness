import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "@/cli/program.js";

const SESSION_ID_PATTERN = /sess_[A-Za-z0-9_-]{16}/;

import { type ModelClient, ModelError } from "@/model/model.js";

describe("CLI", () => {
  it("CLI-001: runs DemoModel offline, prints answer, and exits zero", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ops-cli-"));
    const io = memoryIO({ dataDir });
    try {
      const code = await runCli(
        ["run", "Check checkout", "--model", "demo"],
        io
      );
      expect(code).toBe(0);
      expect(io.output.stdout.join(" ")).toContain("checkout is operational");
      expect(io.output.stderr.join(" ")).toContain("completed");
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it("CLI-001: forwards model id to OpenRouter client and exits two for failed runs", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ops-cli-"));
    const io = memoryIO({ dataDir });
    const modelIds: Array<string | undefined> = [];
    io.openRouterModel = {
      complete: (request) => {
        modelIds.push(request.modelId);
        return Promise.resolve({
          stopReason: "end_turn",
          text: "OpenRouter answer",
          toolCalls: [],
        });
      },
    };
    try {
      const code = await runCli(
        [
          "run",
          "Check service",
          "--model",
          "openrouter",
          "--model-id",
          "vendor/free-model",
        ],
        io
      );
      expect(code).toBe(0);
      expect(modelIds).toEqual(["vendor/free-model"]);
      expect(io.output.stdout.join(" ")).toContain("OpenRouter answer");

      io.openRouterModel = {
        complete: () =>
          Promise.reject(new ModelError("provider unavailable", false)),
      };
      expect(await runCli(["run", "Fail", "--model", "openrouter"], io)).toBe(
        2
      );
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it("CLI-001: rejects model id when DemoModel is selected", async () => {
    const io = memoryIO();
    const code = await runCli(
      [
        "run",
        "Check checkout",
        "--model",
        "demo",
        "--model-id",
        "vendor/model",
      ],
      io
    );

    expect(code).toBe(2);
    expect(io.output.stderr.join(" ")).toContain(
      "--model-id requires --model openrouter"
    );
  });

  it("CLI-002: prompt yes allows, prompt no denies, and non-TTY defaults to deny", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ops-cli-approval-"));
    const io = memoryIO({ dataDir, isTTY: true, prompt: async () => "yes" });
    try {
      const approved = await runCli(
        [
          "run",
          "Investigate payments",
          "--model",
          "demo",
          "--approve",
          "prompt",
        ],
        io
      );
      expect(approved).toBe(0);
      expect(io.output.stderr.join(" ")).toContain("Approve create_incident?");
      expect(io.output.stdout.join(" ")).toContain("INC-0001");

      io.prompt = async () => "no";
      const denied = await runCli(
        [
          "run",
          "Investigate payments",
          "--model",
          "demo",
          "--approve",
          "prompt",
        ],
        io
      );
      expect(denied).toBe(0);
      expect(io.output.stdout.join(" ")).toContain(
        "Incident creation was denied"
      );

      io.isTTY = false;
      const nonTTY = await runCli(
        ["run", "Investigate payments", "--model", "demo"],
        io
      );
      expect(nonTTY).toBe(0);
      expect(io.output.stdout.join(" ")).toContain(
        "Incident creation was denied"
      );
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it("CLI-003 + CLI-004 + OBS-001: show summary and render the session trace", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ops-cli-trace-"));
    const io = memoryIO({ dataDir });
    try {
      await runCli(["run", "Check checkout", "--model", "demo"], io);
      const sessionId = io.output.stderr
        .join(" ")
        .match(SESSION_ID_PATTERN)?.[0];
      expect(sessionId).toBeDefined();

      expect(
        await runCli(["show", sessionId ?? "", "--data-dir", dataDir], io)
      ).toBe(0);
      expect(io.output.stdout.join(" ")).toContain('"status":"completed"');
      expect(
        await runCli(["trace", sessionId ?? "", "--data-dir", dataDir], io)
      ).toBe(0);
      expect(io.output.stdout.join(" ")).toContain("session.created");
      expect(
        await runCli(
          ["trace", sessionId ?? "", "--json", "--data-dir", dataDir],
          io
        )
      ).toBe(0);
      const jsonLines = io.output.stdout.at(-1)?.trim().split("\n") ?? [];
      expect(
        jsonLines.every((line) => JSON.parse(line).sessionId === sessionId)
      ).toBe(true);
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  });

  it("CLI-005: serve binds an ephemeral port and answers healthz", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ops-cli-serve-"));
    const io = memoryIO({
      dataDir,
      openRouterModel: {
        complete: () =>
          Promise.resolve({ stopReason: "end_turn", text: "", toolCalls: [] }),
      },
    });
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    io.onServe = (port, close) => {
      fetch(`http://127.0.0.1:${port}/healthz`)
        .then(async (response) => {
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: true });
          close();
          resolveDone?.();
        })
        .catch((error: unknown) => {
          io.output.stderr.push(String(error));
          close();
          resolveDone?.();
        });
    };
    try {
      expect(
        await runCli(["serve", "--port", "0", "--host", "127.0.0.1"], io)
      ).toBe(0);
      await done;
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  });
});

interface CliIO {
  dataDir?: string;
  isTTY?: boolean;
  onServe?: (port: number, close: () => void) => void;
  openRouterModel?: ModelClient;
  output: { stderr: string[]; stdout: string[] };
  prompt?: (message: string) => Promise<string>;
  stderr: (text: string) => void;
  stdout: (text: string) => void;
}

const memoryIO = (options: Partial<CliIO> = {}): CliIO => {
  const output = { stderr: [] as string[], stdout: [] as string[] };
  return {
    ...options,
    output,
    stderr: (text) => output.stderr.push(text),
    stdout: (text) => output.stdout.push(text),
  };
};
