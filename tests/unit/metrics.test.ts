import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { AgentLoop } from "@/core/loop/agent-loop.js";
import { createMetrics } from "@/core/observability/metrics.js";
import { ToolRegistry } from "@/core/tools/registry.js";
import { ScriptedModel } from "@/model/scripted.js";

describe("metrics", () => {
  it("OBS-006: renders request, tool, session counters and duration histogram", () => {
    const metrics = createMetrics();
    metrics.recordModelRequest();
    metrics.recordModelRequest();
    metrics.recordToolCall("create_incident", "ok");
    metrics.recordToolCall("search_knowledge_base", "upstream_unavailable");
    metrics.recordSession("timeout");
    metrics.observeToolDuration("create_incident", 12);

    expect(metrics.render()).toContain("ops_model_requests_total 2");
    expect(metrics.render()).toContain(
      'ops_tool_calls_total{outcome="ok",tool="create_incident"} 1'
    );
    expect(metrics.render()).toContain(
      'ops_sessions_total{stop_reason="timeout"} 1'
    );
    expect(metrics.render()).toContain(
      'ops_tool_duration_ms_bucket{tool="create_incident",le="25"} 1'
    );
    expect(metrics.render()).toContain(
      'ops_tool_duration_ms_sum{tool="create_incident"} 12'
    );
  });

  it("OBS-006: AgentLoop records real request and session metrics", async () => {
    const metrics = createMetrics();
    const eventLog = new InMemoryEventLog();
    const sessionId = "sess_metrics_loop";
    eventLog.append(sessionId, {
      objective: "Check checkout",
      type: "session.created",
    });
    const loop = new AgentLoop({
      metrics,
      model: new ScriptedModel([
        { stopReason: "end_turn", text: "Healthy.", toolCalls: [] },
      ]),
      registry: new ToolRegistry([]),
    });

    for await (const _event of loop.execute({
      eventLog,
      objective: "Check checkout",
      onStop: () => undefined,
      sessionId,
    })) {
      // Metrics are observed through the in-process collector.
    }

    expect(metrics.render()).toContain("ops_model_requests_total 1");
    expect(metrics.render()).toContain(
      'ops_sessions_total{stop_reason="end_turn"} 1'
    );
  });
});
