import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError } from "@/core/tools/errors.js";
import { ToolExecutor } from "@/core/tools/executor.js";
import { defineTool, ToolRegistry } from "@/core/tools/registry.js";

describe("ToolExecutor", () => {
  const registry = new ToolRegistry([
    defineTool({
      description: "Ping the service",
      handler: async () => ({ pong: "pong" }),
      input: z.object({ address: z.string() }),
      name: "ping",
      output: z.object({ pong: z.string() }),
    }),
  ]);
  const executor = new ToolExecutor(registry);

  it("TOOL-001: inspect/run unknown tool return same unknown_tool listing valid tools", async () => {
    const call = { arguments: {}, id: "call_1", name: "does_not_exist" };

    const inspected = await executor.inspect(call);
    const ran = await executor.run(call, {
      idempotencyKey: "sess:call_1",
      signal: new AbortController().signal,
    });

    expect(inspected).toEqual(ran);
    if (ran.ok) {
      throw new Error("expected failure");
    }
    expect(ran.error.code).toBe("unknown_tool");
    expect(ran.error.retryable).toBe(false);
    expect(ran.content).toContain("ping");
  });

  it("TOOL-002: inspect/run invalid input return same invalid_input, handler not called", async () => {
    let handlerCalls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Needs a severity",
        handler: () => {
          handlerCalls += 1;
          return Promise.resolve({ ok: true });
        },
        input: z.object({ severity: z.enum(["low", "high"]) }),
        name: "needs_severity",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry);
    const call = {
      arguments: { severity: "bogus" },
      id: "call_invalid",
      name: "needs_severity",
    };

    const inspected = await localExecutor.inspect(call);
    const ran = await localExecutor.run(call, {
      idempotencyKey: "sess:call_invalid",
      signal: new AbortController().signal,
    });

    expect(inspected).toEqual(ran);
    if (ran.ok) {
      throw new Error("expected failure");
    }
    expect(ran.error.code).toBe("invalid_input");
    expect(ran.error.retryable).toBe(false);
    expect(ran.content).toContain("severity");
    expect(handlerCalls).toBe(0);
  });

  it("TOOL-009: success returns JSON content, truncated beyond maxResultChars", async () => {
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Returns a large output",
        handler: () => Promise.resolve({ data: "x".repeat(200) }),
        input: z.object({}),
        name: "big_output",
        output: z.object({ data: z.string() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      maxResultChars: 50,
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_big", name: "big_output" },
      { idempotencyKey: "sess:call_big", signal: new AbortController().signal }
    );

    expect(ran.ok).toBe(true);
    if (ran.ok) {
      expect(ran.content.length).toBeGreaterThan(50);
      expect(ran.content).toContain("[truncated");
      expect(ran.content.slice(0, 50)).toBe(
        '{"data":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      );
      expect(ran.output).toEqual({ data: "x".repeat(200) });
    }
  });

  it("TOOL-003: output failing schema → invalid_output, bad data not leaked", async () => {
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Returns output violating schema",
        handler: () =>
          Promise.resolve({ status: "unexpected" } as unknown as {
            status: "ok" | "error";
          }),
        input: z.object({}),
        name: "bad_output",
        output: z.object({ status: z.enum(["ok", "error"]) }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry);
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_bad_out", name: "bad_output" },
      {
        idempotencyKey: "sess:call_bad_out",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("invalid_output");
      expect(ran.error.retryable).toBe(false);
      expect(ran.content).not.toContain("unexpected");
      expect(ran.attempts).toBe(1);
    }
  });

  it("TOOL-004: retryable error retried with exponential backoff", async () => {
    const delays: number[] = [];
    let calls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Fails twice then succeeds",
        handler: () => {
          calls += 1;
          if (calls < 3) {
            throw new ToolError("upstream_unavailable", "boom", true);
          }
          return Promise.resolve({ ok: true });
        },
        input: z.object({}),
        name: "flaky",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 10,
      random: () => 0.5,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_flaky", name: "flaky" },
      {
        idempotencyKey: "sess:call_flaky",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBe(10);
    expect(delays[1]).toBe(20);
  });

  it("TOOL-011: plain Error → execution_error retryable", async () => {
    let calls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Throws plain error once",
        handler: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("plain boom");
          }
          return Promise.resolve({ ok: true });
        },
        input: z.object({}),
        name: "plain_error",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_plain", name: "plain_error" },
      {
        idempotencyKey: "sess:call_plain",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("TOOL-006: not_found not retried", async () => {
    let calls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Throws not_found",
        handler: () => {
          calls += 1;
          throw new ToolError("not_found", "missing", false);
        },
        input: z.object({}),
        name: "missing_record",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_missing", name: "missing_record" },
      {
        idempotencyKey: "sess:call_missing",
        signal: new AbortController().signal,
      }
    );

    expect(calls).toBe(1);
    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("not_found");
      expect(ran.error.retryable).toBe(false);
      expect(ran.attempts).toBe(1);
    }
  });

  it("TOOL-007: idempotent:false never retried", async () => {
    let calls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Non-idempotent tool throws retryable error",
        handler: () => {
          calls += 1;
          throw new ToolError("upstream_unavailable", "boom", true);
        },
        idempotent: false,
        input: z.object({}),
        name: "non_idempotent",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_non_idem", name: "non_idempotent" },
      {
        idempotencyKey: "sess:call_non_idem",
        signal: new AbortController().signal,
      }
    );

    expect(calls).toBe(1);
    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("upstream_unavailable");
      expect(ran.attempts).toBe(1);
    }
  });

  it("TOOL-005: handler exceeding timeoutMs is aborted and reported as timeout", async () => {
    let seenSignal: AbortSignal | undefined;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Never settles",
        handler: (_input, ctx) => {
          seenSignal = ctx.signal;
          return new Promise(() => {
            // Intentionally never settles: the executor must abort via timeout.
          });
        },
        input: z.object({}),
        maxRetries: 1,
        name: "staller",
        output: z.object({ ok: z.boolean() }),
        timeoutMs: 20,
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_stall", name: "staller" },
      {
        idempotencyKey: "sess:call_stall",
        signal: new AbortController().signal,
      }
    );

    expect(seenSignal?.aborted).toBe(true);
    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("timeout");
      expect(ran.error.retryable).toBe(true);
      expect(ran.attempts).toBe(2);
    }
  }, 1000);

  it("TOOL-010: run signal abort stops immediately with aborted, no retry", async () => {
    let calls = 0;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Waits forever",
        handler: (_input, ctx) => {
          calls += 1;
          startedResolve?.();
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => {
              reject(new Error("aborted by signal"));
            });
          });
        },
        input: z.object({}),
        maxRetries: 3,
        name: "wait_forever",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const controller = new AbortController();
    const ranPromise = localExecutor.run(
      { arguments: {}, id: "call_wait", name: "wait_forever" },
      { idempotencyKey: "sess:call_wait", signal: controller.signal }
    );
    await started;
    controller.abort();
    const ran = await ranPromise;

    expect(calls).toBe(1);
    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("aborted");
      expect(ran.error.retryable).toBe(false);
      expect(ran.attempts).toBe(1);
    }
  });

  it("TOOL-008: idempotencyKey identical across retries", async () => {
    const keys: string[] = [];
    let calls = 0;
    const localRegistry = new ToolRegistry([
      defineTool({
        description: "Fails twice then succeeds",
        handler: (_input, ctx) => {
          calls += 1;
          keys.push(ctx.idempotencyKey);
          if (calls < 3) {
            throw new ToolError("upstream_unavailable", "boom", true);
          }
          return Promise.resolve({ ok: true });
        },
        input: z.object({}),
        name: "keyed",
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      { arguments: {}, id: "call_keyed", name: "keyed" },
      {
        idempotencyKey: "sess:call_keyed",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    expect(calls).toBe(3);
    expect(keys).toEqual([
      "sess:call_keyed",
      "sess:call_keyed",
      "sess:call_keyed",
    ]);
  });
});
