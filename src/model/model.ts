import type {
  ChatFunctionToolFunction,
  ChatMessages,
} from "@openrouter/sdk/models";
import { z } from "zod";

export type ModelStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "other";

export const ModelResponseSchema = z.object({
  raw: z.unknown().optional(),
  stopReason: z.enum([
    "end_turn",
    "tool_use",
    "max_tokens",
    "refusal",
    "other",
  ]),
  text: z.string(),
  toolCalls: z.array(
    z.object({
      id: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      name: z.string().min(1),
    })
  ),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export interface ModelRequest {
  messages: ChatMessages[];
  modelId?: string;
  signal: AbortSignal;
  system: string;
  tools: ChatFunctionToolFunction[];
}

export interface ModelClient {
  complete: (request: ModelRequest) => Promise<ModelResponse>;
}

export class ModelError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelError";
    this.retryable = retryable;
  }
}

export class ModelProtocolError extends Error {
  readonly detail: string;
  readonly raw?: unknown;

  constructor(detail: string, raw?: unknown, options?: ErrorOptions) {
    super(`Model protocol error: ${detail}`, options);
    this.name = "ModelProtocolError";
    this.detail = detail;
    this.raw = raw;
  }
}
