import { OpenRouter } from "@openrouter/sdk";
import type {
  ChatAssistantMessage,
  ChatFunctionToolFunction,
} from "@openrouter/sdk/models";
import {
  ConnectionError,
  OpenRouterError,
  RequestAbortedError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
} from "@openrouter/sdk/models/errors";
import { z } from "zod";
import {
  type ModelClient,
  ModelError,
  ModelProtocolError,
  type ModelRequest,
  ModelResponseSchema,
} from "@/model/model.js";

const DEFAULT_MODEL_ID = "deepseek/deepseek-v4.1-flash";

interface OpenRouterChatClient {
  chat: {
    send: (
      request: { chatRequest: Record<string, unknown> },
      options: { signal: AbortSignal; retries: { strategy: "none" } }
    ) => Promise<unknown>;
  };
}

export interface OpenRouterModelOptions {
  apiKey?: string;
  client?: OpenRouterChatClient;
  modelId?: string;
}

export class OpenRouterModel implements ModelClient {
  readonly #client: OpenRouterChatClient;
  readonly #modelId: string;

  constructor(options: OpenRouterModelOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!(options.client || apiKey)) {
      throw new Error("OPENROUTER_API_KEY is required");
    }
    this.#client =
      options.client ??
      (new OpenRouter({ apiKey }) as unknown as OpenRouterChatClient);
    const configuredModel = options.modelId;
    const environmentModel = process.env.OPENROUTER_MODEL;
    if (nonEmpty(configuredModel)) {
      this.#modelId = configuredModel;
    } else if (nonEmpty(environmentModel)) {
      this.#modelId = environmentModel;
    } else {
      this.#modelId = DEFAULT_MODEL_ID;
    }
  }

  async complete(request: ModelRequest) {
    const model = nonEmpty(request.modelId) ? request.modelId : this.#modelId;
    let response: OpenRouterResponse;
    try {
      response = (await this.#client.chat.send(
        {
          chatRequest: {
            maxCompletionTokens: 16_000,
            messages: [
              { content: request.system, role: "system" },
              ...request.messages,
            ],
            model,
            stream: false,
            tools: request.tools as ChatFunctionToolFunction[],
          },
        },
        { retries: { strategy: "none" }, signal: request.signal }
      )) as OpenRouterResponse;
    } catch (error) {
      throw mapSdkError(error);
    }

    const choice = response.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new ModelProtocolError(
        "Response did not contain an assistant message",
        response
      );
    }
    let toolCalls: Array<{
      id: string;
      input: Record<string, unknown>;
      name: string;
    }>;
    try {
      toolCalls = (message.toolCalls ?? []).map((call) => {
        const parsed: unknown = JSON.parse(call.function.arguments);
        const input = z.record(z.string(), z.unknown()).safeParse(parsed);
        if (!(input.success && call.id && call.function.name)) {
          throw new Error("invalid tool call");
        }
        return { id: call.id, input: input.data, name: call.function.name };
      });
    } catch (error) {
      const protocolError = new ModelProtocolError(
        "Assistant tool arguments must be JSON objects",
        message
      );
      protocolError.cause = error;
      throw protocolError;
    }
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      text = message.content
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
    }
    const result = ModelResponseSchema.safeParse({
      raw: message,
      stopReason: mapStopReason(choice.finishReason, message.refusal),
      text,
      toolCalls,
      ...(response.usage && {
        usage: {
          inputTokens: response.usage.promptTokens,
          outputTokens: response.usage.completionTokens,
        },
      }),
    });
    if (!result.success) {
      throw new ModelProtocolError(
        "Response did not match model response schema",
        response
      );
    }
    return result.data;
  }
}

interface OpenRouterResponse {
  choices?: Array<{
    finishReason?: string | null;
    message?: ChatAssistantMessage;
  }>;
  usage?: { completionTokens: number; promptTokens: number };
}

function mapStopReason(
  finishReason: string | null | undefined,
  refusal: string | null | undefined
): "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other" {
  if (
    (refusal && refusal.trim().length > 0) ||
    finishReason === "content_filter"
  ) {
    return "refusal";
  }
  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "other";
  }
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mapSdkError(error: unknown): Error {
  if (error instanceof RequestAbortedError) {
    return error;
  }
  if (error instanceof ResponseValidationError) {
    return new ModelProtocolError(
      "OpenRouter response failed SDK validation",
      { rawMessage: error.rawMessage, rawValue: error.rawValue },
      { cause: error }
    );
  }
  if (error instanceof SDKValidationError) {
    return new ModelError("OpenRouter rejected the request shape", false, {
      cause: error,
    });
  }
  if (
    error instanceof ConnectionError ||
    error instanceof RequestTimeoutError
  ) {
    return new ModelError("OpenRouter transport failed", true, {
      cause: error,
    });
  }
  if (error instanceof OpenRouterError) {
    const retryable =
      error.statusCode === 408 ||
      error.statusCode === 429 ||
      (error.statusCode >= 500 && error.statusCode <= 599) ||
      error.statusCode === 524 ||
      error.statusCode === 529;
    return new ModelError("OpenRouter returned an HTTP error", retryable, {
      cause: error,
    });
  }
  return new ModelError("OpenRouter request failed", false, { cause: error });
}
