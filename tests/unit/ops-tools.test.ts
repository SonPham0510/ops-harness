import { describe, expect, it } from "vitest";
import { ToolExecutor } from "@/core/tools/executor.js";
import { ToolRegistry } from "@/core/tools/registry.js";
import { createOpsTools, FaultPlan } from "@/tools/ops/faults.js";
import { createIncidentTool, IncidentStore } from "@/tools/ops/incidents.js";
import {
  createKnowledgeBaseTool,
  knowledgeBaseEntries,
} from "@/tools/ops/knowledge-base.js";
import {
  createServiceStatusTool,
  serviceStatuses,
} from "@/tools/ops/service-status.js";

describe("ops tools", () => {
  const registry = new ToolRegistry([
    createKnowledgeBaseTool(),
    createServiceStatusTool(),
  ]);
  const executor = new ToolExecutor(registry);

  it("OPS-001: search_knowledge_base ranks checkout runbook first for checkout latency", async () => {
    const ran = await executor.run(
      {
        arguments: { query: "checkout latency" },
        id: "call_kb",
        name: "search_knowledge_base",
      },
      {
        idempotencyKey: "sess:call_kb",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      throw new Error(`unexpected failure: ${ran.error.code}`);
    }
    const { results } = ran.output as { results: Array<{ title: string }> };
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0]?.title).toContain("Checkout");
    expect(knowledgeBaseEntries.length).toBeGreaterThan(5);
  });

  it("OPS-002: get_service_status returns status for known service", async () => {
    const ran = await executor.run(
      {
        arguments: { service_name: "checkout" },
        id: "call_status",
        name: "get_service_status",
      },
      {
        idempotencyKey: "sess:call_status",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      throw new Error(`unexpected failure: ${ran.error.code}`);
    }
    const output = ran.output as {
      service: string;
      status: "operational" | "degraded" | "outage";
    };
    expect(output.service).toBe("checkout");
    expect(["operational", "degraded", "outage"]).toContain(output.status);
    expect(serviceStatuses).toHaveProperty("checkout");
  });

  it("OPS-002: get_service_status unknown service → not_found", async () => {
    const ran = await executor.run(
      {
        arguments: { service_name: "does-not-exist" },
        id: "call_status_missing",
        name: "get_service_status",
      },
      {
        idempotencyKey: "sess:call_status_missing",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("not_found");
      expect(ran.error.retryable).toBe(false);
    }
  });

  it("OPS-002: get_service_status invalid service name → invalid_input", async () => {
    const ran = await executor.run(
      {
        arguments: { service_name: "Bad Name!" },
        id: "call_status_bad",
        name: "get_service_status",
      },
      {
        idempotencyKey: "sess:call_status_bad",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(false);
    if (!ran.ok) {
      expect(ran.error.code).toBe("invalid_input");
      expect(ran.error.retryable).toBe(false);
    }
  });

  it("OPS-003: create_incident requires approval and creates incident", async () => {
    const store = new IncidentStore();
    const localRegistry = new ToolRegistry([createIncidentTool(store)]);
    const localExecutor = new ToolExecutor(localRegistry);
    const call = {
      arguments: {
        description: "Checkout service is returning 500s for all users.",
        severity: "high",
        title: "Checkout is down",
      },
      id: "call_incident",
      name: "create_incident",
    };

    const inspected = await localExecutor.inspect(call);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.requiresApproval).toBe(true);
    }

    const ran = await localExecutor.run(call, {
      idempotencyKey: "sess:call_incident",
      signal: new AbortController().signal,
    });
    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      throw new Error(`unexpected failure: ${ran.error.code}`);
    }
    const output = ran.output as {
      createdAt: string;
      deduplicated: boolean;
      incidentId: string;
      severity: string;
      url: string;
    };
    expect(output.incidentId).toBeTruthy();
    expect(output.url).toContain("incidents");
    expect(output.severity).toBe("high");
    expect(output.deduplicated).toBe(false);
    expect(output.createdAt).toBeTruthy();
  });

  it("OPS-004: same idempotency key returns deduplicated incident, store size 1", async () => {
    const store = new IncidentStore();
    const localRegistry = new ToolRegistry([createIncidentTool(store)]);
    const localExecutor = new ToolExecutor(localRegistry);
    const call = {
      arguments: {
        description: "Payment provider is reporting elevated error rates.",
        severity: "medium",
        title: "Payments degraded",
      },
      id: "call_incident_dup",
      name: "create_incident",
    };
    const ctx = {
      idempotencyKey: "sess:call_incident_dup",
      signal: new AbortController().signal,
    };

    const first = await localExecutor.run(call, ctx);
    const second = await localExecutor.run(call, ctx);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!(first.ok && second.ok)) {
      throw new Error("expected both to succeed");
    }
    const firstOutput = first.output as {
      deduplicated: boolean;
      incidentId: string;
    };
    const secondOutput = second.output as {
      deduplicated: boolean;
      incidentId: string;
    };
    expect(firstOutput.deduplicated).toBe(false);
    expect(secondOutput.deduplicated).toBe(true);
    expect(secondOutput.incidentId).toBe(firstOutput.incidentId);
    expect(store.size()).toBe(1);
  });

  it("OPS-005: injected retryable error → attempts 2 then ok", async () => {
    const plan = new FaultPlan();
    plan.enqueue("search_knowledge_base", {
      kind: "error",
      retryable: true,
    });
    const localRegistry = new ToolRegistry(
      createOpsTools({ knowledgeBase: { entries: knowledgeBaseEntries } }, plan)
    );
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const ran = await localExecutor.run(
      {
        arguments: { query: "checkout latency" },
        id: "call_kb_fault",
        name: "search_knowledge_base",
      },
      {
        idempotencyKey: "sess:call_kb_fault",
        signal: new AbortController().signal,
      }
    );

    expect(ran.ok).toBe(true);
    expect(ran.attempts).toBe(2);
  });

  it("OPS-005: errorAfterCommit + retry → 1 incident, lần 2 deduplicated", async () => {
    const store = new IncidentStore();
    const plan = new FaultPlan();
    plan.enqueue("create_incident", { kind: "errorAfterCommit" });
    const localRegistry = new ToolRegistry(
      createOpsTools({ incidents: { store } }, plan)
    );
    const localExecutor = new ToolExecutor(localRegistry, {
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    const call = {
      arguments: {
        description: "Search service is returning errors for all queries.",
        severity: "high",
        title: "Search outage",
      },
      id: "call_incident_fault",
      name: "create_incident",
    };
    const ran = await localExecutor.run(call, {
      idempotencyKey: "sess:call_incident_fault",
      signal: new AbortController().signal,
    });

    expect(ran.ok).toBe(true);
    if (!ran.ok) {
      throw new Error(`unexpected failure: ${ran.error.code}`);
    }
    expect(ran.attempts).toBe(2);
    expect((ran.output as { deduplicated: boolean }).deduplicated).toBe(true);
    expect(store.size()).toBe(1);
  });
});
