import { z } from "zod";
import { defineTool } from "@/core/tools/registry.js";

export interface IncidentRecord {
  createdAt: string;
  description: string;
  idempotencyKey: string;
  incidentId: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
}

export class IncidentStore {
  readonly #byKey = new Map<string, IncidentRecord>();
  #nextId = 1;

  dedupe(key: string): IncidentRecord | undefined {
    return this.#byKey.get(key);
  }

  nextId(): string {
    const id = `INC-${String(this.#nextId).padStart(4, "0")}`;
    this.#nextId += 1;
    return id;
  }

  put(record: IncidentRecord): void {
    this.#byKey.set(record.idempotencyKey, record);
  }

  size(): number {
    return this.#byKey.size;
  }
}

const inputSchema = z.object({
  description: z.string().min(10).max(4000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(5).max(120),
});

const outputSchema = z.object({
  createdAt: z.string(),
  deduplicated: z.boolean(),
  incidentId: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  url: z.string(),
});

export const createIncidentTool = (store: IncidentStore) =>
  defineTool({
    description:
      "Create an incident in the external incident management system.",
    handler: ({ description, severity, title }, ctx) => {
      const existing = store.dedupe(ctx.idempotencyKey);
      if (existing) {
        return Promise.resolve({
          createdAt: existing.createdAt,
          deduplicated: true,
          incidentId: existing.incidentId,
          severity: existing.severity,
          url: `https://ops.example.com/incidents/${existing.incidentId}`,
        });
      }
      const createdAt = new Date().toISOString();
      const incidentId = store.nextId();
      store.put({
        createdAt,
        description,
        idempotencyKey: ctx.idempotencyKey,
        incidentId,
        severity,
        title,
      });
      return Promise.resolve({
        createdAt,
        deduplicated: false,
        incidentId,
        severity,
        url: `https://ops.example.com/incidents/${incidentId}`,
      });
    },
    idempotent: true,
    input: inputSchema,
    name: "create_incident",
    output: outputSchema,
    requiresApproval: true,
  });
