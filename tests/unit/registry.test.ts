import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError } from "@/core/tools/errors.js";
import { defineTool, ToolRegistry } from "@/core/tools/registry.js";

describe("ToolRegistry", () => {
  it("T2.1: specs() returns OpenRouter function tool schemas with JSON Schema parameters and required names", () => {
    const check = defineTool({
      description: "Check checkout latency",
      handler: async () => ({ ok: true }),
      input: z.object({ service: z.string(), timeout: z.number().optional() }),
      name: "checkout_latency",
      output: z.object({ ok: z.boolean() }),
    });
    const registry = new ToolRegistry([check]);

    const specs = registry.specs();
    const spec = specs.find((s) => s.function.name === "checkout_latency");

    expect(spec).toEqual({
      function: {
        description: "Check checkout latency",
        name: "checkout_latency",
        parameters: {
          additionalProperties: false,
          properties: {
            service: { type: "string" },
            timeout: { type: "number" },
          },
          required: ["service"],
          type: "object",
        },
      },
      type: "function",
    });
  });

  it("T2.1: ToolError carries code and retryable flag", () => {
    const error = new ToolError("not_found", "Service missing", false);
    expect(error.code).toBe("not_found");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Service missing");
    expect(error).toBeInstanceOf(Error);
  });
});
