import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "@/core/events/event-log.js";
import { AgentLoop } from "@/core/loop/agent-loop.js";
import { SessionManager } from "@/core/session/session-manager.js";
import { ToolRegistry } from "@/core/tools/registry.js";
import { DemoModel } from "@/model/demo.js";
import { createOpsTools } from "@/tools/ops/faults.js";
import { IncidentStore } from "@/tools/ops/incidents.js";

describe("DemoModel", () => {
  it("MDL-006: checks degraded service, searches KB, creates approved incident, and summarizes it", async () => {
    const eventLog = new InMemoryEventLog();
    const incidentStore = new IncidentStore();
    const loop = new AgentLoop({
      model: new DemoModel(),
      registry: new ToolRegistry(
        createOpsTools({ incidents: { store: incidentStore } })
      ),
    });
    const manager = new SessionManager({
      approvalPolicy: "auto_allow",
      eventLog,
      loop,
    });

    const session = await manager.start({ objective: "Investigate payments" });
    const events = eventLog.getEvents(session.id);

    expect(session).toMatchObject({
      status: "completed",
      stopReason: "end_turn",
    });
    expect(
      events
        .filter((event) => event.type === "agent.tool_use")
        .map((event) => event.type === "agent.tool_use" && event.name)
    ).toEqual([
      "get_service_status",
      "search_knowledge_base",
      "create_incident",
    ]);
    expect(incidentStore.size()).toBe(1);
    expect(session.finalAnswer).toContain("INC-0001");
    expect(session.finalAnswer).toContain("degraded");
  });

  it("MDL-006: reports operational service without creating an incident", async () => {
    const incidentStore = new IncidentStore();
    const manager = new SessionManager({
      eventLog: new InMemoryEventLog(),
      loop: new AgentLoop({
        model: new DemoModel(),
        registry: new ToolRegistry(
          createOpsTools({ incidents: { store: incidentStore } })
        ),
      }),
    });

    const session = await manager.start({ objective: "Check checkout" });

    expect(session.status).toBe("completed");
    expect(session.finalAnswer).toContain("operational");
    expect(incidentStore.size()).toBe(0);
  });
});
