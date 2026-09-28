import {
  ConnectionError,
  OpenRouterError,
  RequestAbortedError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
} from "@openrouter/sdk/models/errors";
import { describe, expect, it, vi } from "vitest";
import { ModelProtocolError } from "@/model/model.js";
import { OpenRouterModel } from "@/model/openrouter.js";

describe("OpenRouterModel", () => {
  const request = {
    messages: [{ content: "hello", role: "user" as const }],
    signal: new AbortController().signal,
    system: "Be concise",
    tools: [],
  };

  it("MDL-001/004: sends SDK chat request and honors request model override", async () => {
    const send = vi.fn().mockResolvedValue({
      choices: [
        {
          finishReason: "stop",
          message: { content: "Ready.", role: "assistant" },
        },
      ],
      usage: { completionTokens: 2, promptTokens: 3 },
    });
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
      modelId: "constructor/model",
    });
    const { signal } = new AbortController();

    await model.complete({
      ...request,
      modelId: "request/model",
      signal,
    });

    expect(send).toHaveBeenCalledWith(
      {
        chatRequest: {
          maxCompletionTokens: 16_000,
          messages: [
            { content: "Be concise", role: "system" },
            { content: "hello", role: "user" },
          ],
          model: "request/model",
          stream: false,
          tools: [],
        },
      },
      { retries: { strategy: "none" }, signal }
    );
  });

  it("MDL-004: falls back from constructor model to environment then default", async () => {
    const send = vi.fn().mockResolvedValue({
      choices: [
        { finishReason: "stop", message: { content: "ok", role: "assistant" } },
      ],
    });
    vi.stubEnv("OPENROUTER_MODEL", "env/model");
    const fromEnv = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });
    await fromEnv.complete(request);
    expect(send.mock.calls[0]?.[0].chatRequest.model).toBe("env/model");

    const fromConstructor = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
      modelId: "constructor/model",
    });
    await fromConstructor.complete(request);
    expect(send.mock.calls[1]?.[0].chatRequest.model).toBe("constructor/model");

    vi.stubEnv("OPENROUTER_MODEL", "");
    const fromDefault = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });
    await fromDefault.complete(request);
    expect(send.mock.calls[2]?.[0].chatRequest.model).toBe(
      "deepseek/deepseek-v4.1-flash"
    );
    vi.unstubAllEnvs();
  });

  it("MDL-002: maps text parts, tool calls, stop reason, usage, and preserves raw message", async () => {
    const message = {
      content: [
        { text: "Checking ", type: "text" },
        { text: "service", type: "text" },
      ],
      role: "assistant",
      toolCalls: [
        {
          function: {
            arguments: '{"service":"payments"}',
            name: "get_service_status",
          },
          id: "call-1",
          type: "function",
        },
      ],
    };
    const send = vi.fn().mockResolvedValue({
      choices: [{ finishReason: "tool_calls", message }],
      usage: { completionTokens: 7, promptTokens: 11 },
    });
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).resolves.toEqual({
      raw: message,
      stopReason: "tool_use",
      text: "Checking service",
      toolCalls: [
        {
          id: "call-1",
          input: { service: "payments" },
          name: "get_service_status",
        },
      ],
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it("MDL-002: maps refusal and finish reasons", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            finishReason: "stop",
            message: { content: "No", refusal: "unsafe", role: "assistant" },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finishReason: "length",
            message: { content: "Partial", role: "assistant" },
          },
        ],
      });
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).resolves.toMatchObject({
      stopReason: "refusal",
    });
    await expect(model.complete(request)).resolves.toMatchObject({
      stopReason: "max_tokens",
    });
  });

  it("MDL-002: rejects empty choices and malformed tool arguments as protocol errors", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ choices: [] })
      .mockResolvedValueOnce({
        choices: [
          {
            finishReason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              toolCalls: [
                {
                  function: { arguments: "[]", name: "lookup" },
                  id: "call-1",
                  type: "function",
                },
              ],
            },
          },
        ],
      });
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).rejects.toBeInstanceOf(
      ModelProtocolError
    );
    await expect(model.complete(request)).rejects.toBeInstanceOf(
      ModelProtocolError
    );
  });

  it("MDL-003: preserves caller abort and maps SDK connection errors as retryable", async () => {
    const aborted = new RequestAbortedError("cancelled");
    const send = vi
      .fn()
      .mockRejectedValueOnce(aborted)
      .mockRejectedValueOnce(new ConnectionError("network down"))
      .mockRejectedValueOnce(new RequestTimeoutError("timed out"));
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).rejects.toBe(aborted);
    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("MDL-003: classifies typed HTTP status codes without reading error messages", async () => {
    const makeHttpError = (status: number) =>
      new OpenRouterError("opaque", {
        body: "",
        request: new Request("https://openrouter.test"),
        response: new Response(null, { status }),
      });
    const send = vi
      .fn()
      .mockRejectedValueOnce(makeHttpError(429))
      .mockRejectedValueOnce(makeHttpError(401))
      .mockRejectedValueOnce(makeHttpError(529))
      .mockRejectedValueOnce(makeHttpError(418));
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: false,
    });
    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: true,
    });
    await expect(model.complete(request)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("MDL-003: maps SDK response validation to protocol and outbound validation to permanent model error", async () => {
    const responseError = new ResponseValidationError("invalid response", {
      body: "raw body",
      cause: new Error("schema mismatch"),
      rawMessage: "raw message",
      rawValue: { invalid: true },
      request: new Request("https://openrouter.test"),
      response: new Response(null, { status: 200 }),
    });
    const validationError = new SDKValidationError(
      "invalid request",
      new Error("bad"),
      {}
    );
    const send = vi
      .fn()
      .mockRejectedValueOnce(responseError)
      .mockRejectedValueOnce(validationError);
    const model = new OpenRouterModel({
      apiKey: "test-key",
      client: { chat: { send } },
    });

    await expect(model.complete(request)).rejects.toBeInstanceOf(
      ModelProtocolError
    );
    await expect(model.complete(request)).rejects.toMatchObject({
      name: "ModelError",
      retryable: false,
    });
  });
});
