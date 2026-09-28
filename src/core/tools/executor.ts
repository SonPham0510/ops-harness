import { ToolError } from "@/core/tools/errors.js";
import type { ToolRegistry } from "@/core/tools/registry.js";
import type { ToolContext, ToolErrorCode } from "@/types/tool.js";

export interface ToolFailure {
  attempts: number;
  content: string;
  error: { code: ToolErrorCode; message: string; retryable: boolean };
  ok: false;
}

export type ToolInspection =
  | { ok: true; requiresApproval: boolean }
  | ToolFailure;

export type ToolOutcome =
  | { ok: true; output: unknown; content: string; attempts: number }
  | ToolFailure;

export interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}

export interface ToolAttemptSpan {
  attempt: number;
  durationMs: number;
  outcome: string;
}

interface PreparedCall {
  input: Record<string, unknown>;
  ok: true;
  requiresApproval: boolean;
}

export class ToolExecutor {
  readonly #registry: ToolRegistry;
  readonly #maxResultChars: number;
  readonly #baseDelayMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(
    registry: ToolRegistry,
    options?: {
      maxResultChars?: number;
      baseDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
      random?: () => number;
    }
  ) {
    this.#registry = registry;
    this.#maxResultChars = options?.maxResultChars ?? 8000;
    this.#baseDelayMs = options?.baseDelayMs ?? 100;
    this.#sleep =
      options?.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#random = options?.random ?? Math.random;
  }

  inspect(call: ToolCall): Promise<ToolInspection> {
    return this.#prepare(call).then((prepared) =>
      prepared.ok
        ? { ok: true as const, requiresApproval: prepared.requiresApproval }
        : prepared
    );
  }

  async run(
    call: ToolCall,
    ctx: ToolContext,
    options?: { onAttempt?: (span: ToolAttemptSpan) => void }
  ): Promise<ToolOutcome> {
    const prepared = await this.#prepare(call);
    if (!prepared.ok) {
      return prepared;
    }

    const tool = this.#registry.get(call.name);
    if (!tool) {
      return unknownToolFailure(this.#registry);
    }

    const maxRetries = tool.maxRetries ?? 2;
    const runAttempt = async (attempt: number): Promise<ToolOutcome> => {
      if (ctx.signal.aborted) {
        return abortedFailure(attempt - 1);
      }
      const startedAt = Date.now();
      try {
        const handlerSignal =
          tool.timeoutMs === undefined
            ? ctx.signal
            : AbortSignal.any([
                ctx.signal,
                AbortSignal.timeout(tool.timeoutMs),
              ]);
        const output = await withTimeout(
          tool.handler(prepared.input as never, {
            ...ctx,
            signal: handlerSignal,
          }),
          handlerSignal,
          tool.timeoutMs,
          ctx.signal
        );
        const parsedOutput = tool.output.safeParse(output);
        if (!parsedOutput.success) {
          options?.onAttempt?.({
            attempt,
            durationMs: Date.now() - startedAt,
            outcome: "invalid_output",
          });
          return {
            attempts: attempt,
            content: "Tool output failed validation",
            error: {
              code: "invalid_output",
              message: "Tool output failed validation",
              retryable: false,
            },
            ok: false,
          };
        }
        const content = truncate(JSON.stringify(output), this.#maxResultChars);
        options?.onAttempt?.({
          attempt,
          durationMs: Date.now() - startedAt,
          outcome: "ok",
        });
        return { attempts: attempt, content, ok: true, output };
      } catch (error) {
        if (ctx.signal.aborted) {
          return abortedFailure(attempt);
        }
        const mapped = toToolError(error);
        options?.onAttempt?.({
          attempt,
          durationMs: Date.now() - startedAt,
          outcome: mapped.code,
        });
        const lastAttempt = attempt >= maxRetries + 1;
        if (lastAttempt || !mapped.retryable || tool.idempotent === false) {
          return {
            attempts: attempt,
            content: mapped.message,
            error: {
              code: mapped.code,
              message: mapped.message,
              retryable: mapped.retryable,
            },
            ok: false,
          };
        }
        await this.#sleep(backoff(this.#baseDelayMs, attempt, this.#random));
        return runAttempt(attempt + 1);
      }
    };
    return runAttempt(1);
  }

  #prepare(call: ToolCall): Promise<PreparedCall | ToolFailure> {
    if (!this.#registry.has(call.name)) {
      return Promise.resolve(unknownToolFailure(this.#registry));
    }

    const tool = this.#registry.get(call.name);
    const parsed = tool?.input.safeParse(call.arguments);
    if (!parsed?.success) {
      const path = parsed?.error.issues[0]?.path.join(".") ?? "input";
      const message = parsed?.error.issues[0]?.message ?? "Invalid input";
      return Promise.resolve({
        attempts: 0,
        content: `${path}: ${message}`,
        error: {
          code: "invalid_input",
          message: `${path}: ${message}`,
          retryable: false,
        },
        ok: false,
      });
    }

    return Promise.resolve({
      input: parsed.data as Record<string, unknown>,
      ok: true,
      requiresApproval: this.#registry.requiresApproval(call.name),
    });
  }
}

const backoff = (
  baseDelayMs: number,
  attempt: number,
  random: () => number
): number => {
  const delay = baseDelayMs * 2 ** (attempt - 1);
  const jitter = (random() * 2 - 1) * delay * 0.2;
  return Math.max(1, Math.round(delay + jitter));
};

const withTimeout = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
  externalSignal: AbortSignal
): Promise<T> => {
  if (timeoutMs === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      if (externalSignal.aborted) {
        reject(new ToolError("aborted", "Execution aborted", false));
      } else {
        reject(
          new ToolError("timeout", `Tool timed out after ${timeoutMs}ms`, true)
        );
      }
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

const truncate = (content: string, maxResultChars: number): string => {
  if (content.length <= maxResultChars) {
    return content;
  }
  return `${content.slice(0, maxResultChars)}[truncated ${content.length} chars]`;
};

const abortedFailure = (attempts: number): ToolFailure => ({
  attempts,
  content: "Execution aborted",
  error: { code: "aborted", message: "Execution aborted", retryable: false },
  ok: false,
});

const unknownToolFailure = (registry: ToolRegistry): ToolFailure => ({
  attempts: 0,
  content: `Unknown tool. Valid tools: ${registry.names().join(", ")}`,
  error: {
    code: "unknown_tool",
    message: "Unknown tool",
    retryable: false,
  },
  ok: false,
});

const toToolError = (error: unknown): ToolError => {
  if (error instanceof ToolError) {
    return error;
  }
  if (error instanceof Error) {
    return new ToolError("execution_error", error.message, true, {
      cause: error,
    });
  }
  return new ToolError("execution_error", String(error), true);
};
