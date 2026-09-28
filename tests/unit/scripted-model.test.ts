import { describe, expect, it } from "vitest";
import type { ModelResponse } from "@/model/model.js";
import { ModelError, ModelResponseSchema } from "@/model/model.js";
import { ScriptedModel } from "@/model/scripted.js";

const EXHAUSTED_REGEX = /exhausted/i;

describe("ScriptedModel", () => {
  it("MDL-005: ModelResponseSchema accepts valid responses and rejects malformed tool calls", () => {
    expect(
      ModelResponseSchema.safeParse({
        stopReason: "tool_use",
        text: "",
        toolCalls: [
          {
            id: "call_1",
            input: { service: "checkout" },
            name: "get_service_status",
          },
        ],
      }).success
    ).toBe(true);
    expect(
      ModelResponseSchema.safeParse({
        stopReason: "tool_use",
        text: "",
        toolCalls: [{ id: "", input: [], name: "" }],
      }).success
    ).toBe(false);
  });

  it("MDL-005: returns steps in order, records requests, throws when exhausted", async () => {
    const first: ModelResponse = {
      stopReason: "end_turn",
      text: "hello",
      toolCalls: [],
    };
    const second: ModelResponse = {
      stopReason: "tool_use",
      text: "",
      toolCalls: [
        {
          id: "call_1",
          input: { query: "checkout" },
          name: "search_knowledge_base",
        },
      ],
    };
    const model = new ScriptedModel([
      first,
      second,
      () => {
        throw new ModelError("boom", false);
      },
    ]);
    const req = {
      messages: [{ content: "objective", role: "user" as const }],
      modelId: "deepseek/deepseek-v4.1-flash",
      signal: new AbortController().signal,
      system: "system",
      tools: [],
    };

    expect(await model.complete(req)).toEqual(first);
    expect(await model.complete(req)).toEqual(second);
    await expect(model.complete(req)).rejects.toMatchObject({
      message: "boom",
      retryable: false,
    });
    await expect(model.complete(req)).rejects.toThrow(EXHAUSTED_REGEX);
    expect(model.requests).toHaveLength(4);
    expect(model.requests[0]).toEqual(req);
  });

  it("MDL-005: step can be a function receiving the request", async () => {
    const model = new ScriptedModel([
      (request) => ({
        stopReason: "end_turn" as const,
        text: `model ${request.modelId}`,
        toolCalls: [],
      }),
    ]);
    const response = await model.complete({
      messages: [],
      modelId: "deepseek/deepseek-v4.1-flash",
      signal: new AbortController().signal,
      system: "",
      tools: [],
    });

    expect(response.text).toBe("model deepseek/deepseek-v4.1-flash");
  });
});
