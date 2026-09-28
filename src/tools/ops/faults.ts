import type { z } from "zod";
import { ToolError } from "@/core/tools/errors.js";
import { defineTool } from "@/core/tools/registry.js";
import { createIncidentTool, IncidentStore } from "@/tools/ops/incidents.js";
import {
  createKnowledgeBaseTool,
  type KnowledgeBaseEntry,
} from "@/tools/ops/knowledge-base.js";
import {
  createServiceStatusTool,
  type ServiceStatus,
} from "@/tools/ops/service-status.js";
import type {
  ToolContext,
  ToolDefinition,
  ToolErrorCode,
} from "@/types/tool.js";

export type Fault =
  | { code?: ToolErrorCode; kind: "error"; retryable: boolean }
  | { kind: "delay"; ms: number }
  | { kind: "badOutput" }
  | { kind: "errorAfterCommit" };

export class FaultPlan {
  readonly #queues = new Map<string, Fault[]>();

  enqueue(toolName: string, fault: Fault): void {
    const queue = this.#queues.get(toolName) ?? [];
    queue.push(fault);
    this.#queues.set(toolName, queue);
  }

  next(toolName: string): Fault | undefined {
    const queue = this.#queues.get(toolName);
    return queue?.shift();
  }
}

export interface OpsBackends {
  incidents?: { store: IncidentStore };
  knowledgeBase?: { entries?: KnowledgeBaseEntry[] };
  serviceStatus?: { statuses?: Record<string, ServiceStatus> };
}

const withFaults = async (
  toolName: string,
  plan: FaultPlan,
  run: () => Promise<unknown>
): Promise<unknown> => {
  const fault = plan.next(toolName);
  if (!fault) {
    return run();
  }
  switch (fault.kind) {
    case "error":
      throw new ToolError(
        fault.code ?? "upstream_unavailable",
        `Injected fault for ${toolName}`,
        fault.retryable
      );
    case "delay":
      await new Promise<void>((resolve) => setTimeout(resolve, fault.ms));
      return run();
    case "badOutput":
      return null;
    case "errorAfterCommit": {
      await run();
      throw new ToolError(
        "upstream_unavailable",
        `Injected post-commit fault for ${toolName}`,
        true
      );
    }
    default:
      return run();
  }
};

const wrapWithFaults = <TInput extends z.ZodType, TOutput extends z.ZodType>(
  tool: ToolDefinition<TInput, TOutput>,
  plan: FaultPlan
): ToolDefinition<TInput, TOutput> =>
  defineTool({
    ...tool,
    handler: (input, ctx: ToolContext) =>
      withFaults(tool.name, plan, () => tool.handler(input, ctx)) as Promise<
        z.infer<TOutput>
      >,
  });

export const createOpsTools = (
  backends: OpsBackends = {},
  plan = new FaultPlan()
): ToolDefinition[] => [
  wrapWithFaults(
    createKnowledgeBaseTool({
      entries: backends.knowledgeBase?.entries,
    }),
    plan
  ),
  wrapWithFaults(
    createServiceStatusTool({
      statuses: backends.serviceStatus?.statuses,
    }),
    plan
  ),
  wrapWithFaults(
    createIncidentTool(backends.incidents?.store ?? new IncidentStore()),
    plan
  ),
];
