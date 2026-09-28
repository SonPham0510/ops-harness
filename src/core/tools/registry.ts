import type { ChatFunctionToolFunction } from "@openrouter/sdk/models";
import type { z } from "zod";
import type { ToolDefinition } from "@/types/tool.js";

export const defineTool = <
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
>(
  tool: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> => tool;

interface ToolRegistryItem {
  requiresApproval: boolean;
  tool: ToolDefinition;
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolRegistryItem>();

  constructor(tools: readonly ToolDefinition[]) {
    for (const tool of tools) {
      this.#tools.set(tool.name, {
        requiresApproval: tool.requiresApproval ?? false,
        tool,
      });
    }
  }

  specs(): ChatFunctionToolFunction[] {
    return [...this.#tools.values()].map(({ tool }) => ({
      function: {
        description: tool.description,
        name: tool.name,
        parameters: zodToFunctionParameters(tool.input),
      },
      type: "function",
    }));
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name)?.tool;
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  names(): string[] {
    return [...this.#tools.keys()];
  }

  requiresApproval(name: string): boolean {
    return this.#tools.get(name)?.requiresApproval ?? false;
  }
}

export const zodToFunctionParameters = (
  schema: z.ZodType
): Record<string, unknown> => {
  const jsonSchema = schema.toJSONSchema() as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(jsonSchema).filter(([key]) => key !== "$schema")
  );
};
