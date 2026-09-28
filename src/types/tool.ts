import type { z } from "zod";

export type ToolErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "invalid_output"
  | "timeout"
  | "upstream_unavailable"
  | "not_found"
  | "execution_error"
  | "aborted";

export interface ToolContext {
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  description: string;
  handler: (
    input: z.infer<TInput>,
    ctx: ToolContext
  ) => Promise<z.infer<TOutput>>;
  idempotent?: boolean;
  input: TInput;
  maxRetries?: number;
  name: string;
  output: TOutput;
  requiresApproval?: boolean;
  timeoutMs?: number;
}
