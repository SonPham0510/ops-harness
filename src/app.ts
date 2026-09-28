import { join } from "node:path";
import { createHttpServer } from "@/api/server.js";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { JsonlEventLog } from "@/core/events/jsonl-event-log.js";
import { AgentLoop } from "@/core/loop/agent-loop.js";
import type { HarnessLimits } from "@/core/loop/limits.js";
import { createMetrics } from "@/core/observability/metrics.js";
import { SessionManager } from "@/core/session/session-manager.js";
import { ToolRegistry } from "@/core/tools/registry.js";
import type { ModelClient } from "@/model/model.js";
import { createOpsTools } from "@/tools/ops/faults.js";

export const createApp = (options: {
  approvalPolicy?: "manual" | "auto_deny" | "auto_allow";
  dataDir?: string;
  limits?: Partial<HarnessLimits>;
  model: ModelClient;
}) => {
  const eventLog = options.dataDir
    ? new JsonlEventLog(join(options.dataDir, "events"))
    : new InMemoryEventLog();
  const metrics = createMetrics();
  const loop = new AgentLoop({
    limits: options.limits,
    metrics,
    model: options.model,
    registry: new ToolRegistry(createOpsTools()),
  });
  const manager = new SessionManager({
    approvalPolicy: options.approvalPolicy,
    eventLog,
    loop,
  });
  const http = createHttpServer({ manager, metrics });
  return { http, manager, metrics };
};
