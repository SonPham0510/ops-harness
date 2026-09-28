import { z } from "zod";
import { ToolError } from "@/core/tools/errors.js";
import { defineTool } from "@/core/tools/registry.js";

export interface ServiceStatus {
  checkedAt: string;
  errorRate: number;
  latencyP95Ms: number;
  service: string;
  status: "operational" | "degraded" | "outage";
}

export const serviceStatuses: Record<string, ServiceStatus> = {
  checkout: {
    checkedAt: "2026-09-28T00:00:00.000Z",
    errorRate: 0.002,
    latencyP95Ms: 210,
    service: "checkout",
    status: "operational",
  },
  payments: {
    checkedAt: "2026-09-28T00:00:00.000Z",
    errorRate: 0.08,
    latencyP95Ms: 850,
    service: "payments",
    status: "degraded",
  },
  search: {
    checkedAt: "2026-09-28T00:00:00.000Z",
    errorRate: 0.31,
    latencyP95Ms: 1400,
    service: "search",
    status: "outage",
  },
};

const SERVICE_NAME_REGEX = /^[a-z0-9-]{1,64}$/;

const inputSchema = z.object({
  service_name: z.string().regex(SERVICE_NAME_REGEX),
});

const outputSchema = z.object({
  checkedAt: z.string(),
  errorRate: z.number(),
  latencyP95Ms: z.number(),
  service: z.string(),
  status: z.enum(["operational", "degraded", "outage"]),
});

export const createServiceStatusTool = (options?: {
  statuses?: Record<string, ServiceStatus>;
}) => {
  const statuses = options?.statuses ?? serviceStatuses;
  return defineTool({
    description:
      "Retrieve the current status of a service by its short name (e.g. checkout).",
    handler: ({ service_name: serviceName }) => {
      const status = statuses[serviceName];
      if (!status) {
        throw new ToolError(
          "not_found",
          `Unknown service: ${serviceName}`,
          false
        );
      }
      return Promise.resolve(status);
    },
    input: inputSchema,
    name: "get_service_status",
    output: outputSchema,
  });
};
