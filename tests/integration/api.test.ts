import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import type { ModelClient } from "@/model/model.js";

describe("HTTP API", () => {
  it("API-001: creates session asynchronously and preserves arbitrary modelId on every model step", async () => {
    const modelIds: Array<string | undefined> = [];
    let calls = 0;
    const model: ModelClient = {
      complete: (request) => {
        modelIds.push(request.modelId);
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                stopReason: "tool_use",
                text: "",
                toolCalls: [
                  {
                    id: "search-1",
                    input: { query: "payments" },
                    name: "search_knowledge_base",
                  },
                ],
              }
            : {
                stopReason: "end_turn",
                text: "Found the runbook.",
                toolCalls: [],
              }
        );
      },
    };
    const { http, manager } = createApp({ model });
    const response = await http.request("/sessions", {
      body: JSON.stringify({
        limits: { maxSteps: 4 },
        modelId: "vendor/arbitrary-openrouter-model",
        objective: "Investigate payments",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = (await response.json()) as { id: string; status: string };
    await waitFor(() => manager.get(body.id).status === "completed");

    expect(response.status).toBe(201);
    expect(body.status).toBe("queued");
    expect(manager.get(body.id).modelId).toBe(
      "vendor/arbitrary-openrouter-model"
    );
    expect(modelIds).toEqual([
      "vendor/arbitrary-openrouter-model",
      "vendor/arbitrary-openrouter-model",
    ]);
  });

  it("API-001: rejects invalid request bodies and out-of-range limits with 400", async () => {
    const { http } = createApp({
      model: {
        complete: async () => ({
          stopReason: "end_turn",
          text: "",
          toolCalls: [],
        }),
      },
    });
    const responses = await Promise.all(
      [
        { objective: "" },
        { modelId: "", objective: "Check payments" },
        { limits: { maxSteps: 0 }, objective: "Check payments" },
        { objective: "x".repeat(4001) },
      ].map((body) =>
        http.request("/sessions", {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      )
    );
    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400, 400]);
  });

  it("API-001: applies positive per-session limits", async () => {
    const { http, manager } = createApp({
      model: {
        complete: () =>
          Promise.resolve({
            stopReason: "tool_use",
            text: "",
            toolCalls: [{ id: "unknown-1", input: {}, name: "unknown" }],
          }),
      },
    });
    const response = await http.request("/sessions", {
      body: JSON.stringify({
        limits: { maxSteps: 1 },
        objective: "Try a tool",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const { id } = (await response.json()) as { id: string };
    await waitFor(() => manager.get(id).status === "failed");

    expect(manager.get(id).stopReason).toBe("max_steps");
  });

  it("API-002 + API-007: returns session summary, health, and metrics", async () => {
    const { http } = createApp({
      model: {
        complete: async () => ({
          stopReason: "end_turn",
          text: "",
          toolCalls: [],
        }),
      },
    });
    const created = await http.request("/sessions", {
      body: JSON.stringify({ objective: "Check checkout" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const { id } = (await created.json()) as { id: string };
    const getResponse = await http.request(`/sessions/${id}`);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toMatchObject({
      session: { id, objective: "Check checkout" },
      summary: { status: "queued" },
    });

    expect((await http.request("/sessions/missing")).status).toBe(404);
    expect(await (await http.request("/healthz")).json()).toEqual({ ok: true });
    expect(
      (await http.request("/metrics")).headers.get("content-type")
    ).toContain("text/plain");
  });

  it("API-003: returns JSON session events after_seq and validates the cursor", async () => {
    const { http } = createApp({
      model: {
        complete: () =>
          Promise.resolve({
            stopReason: "end_turn",
            text: "done",
            toolCalls: [],
          }),
      },
    });
    const created = await http.request("/sessions", {
      body: JSON.stringify({ objective: "Check service" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const { id } = (await created.json()) as { id: string };
    const all = await http.request(`/sessions/${id}/events`);
    const allBody = (await all.json()) as { events: Array<{ seq: number }> };
    const after = await http.request(`/sessions/${id}/events?after_seq=1`);
    const afterBody = (await after.json()) as {
      events: Array<{ seq: number }>;
    };

    expect(all.status).toBe(200);
    expect(allBody.events[0]?.seq).toBe(1);
    expect(afterBody.events.every(({ seq }) => seq > 1)).toBe(true);
    expect(
      (await http.request(`/sessions/${id}/events?after_seq=-1`)).status
    ).toBe(400);
    expect((await http.request("/sessions/missing/events")).status).toBe(404);
  });

  it("API-005: accepts approval, returns 409 for unknown tool, and 404 for missing session", async () => {
    let calls = 0;
    const { http, manager } = createApp({
      model: {
        complete: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? {
                  stopReason: "tool_use",
                  text: "",
                  toolCalls: [
                    {
                      id: "incident-1",
                      input: {
                        description:
                          "Payments are degraded and need investigation.",
                        severity: "medium",
                        title: "Payments degraded",
                      },
                      name: "create_incident",
                    },
                  ],
                }
              : {
                  stopReason: "end_turn",
                  text: "Incident created.",
                  toolCalls: [],
                }
          );
        },
      },
    });
    const created = await http.request("/sessions", {
      body: JSON.stringify({ objective: "Investigate payments" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const { id } = (await created.json()) as { id: string };
    await waitFor(() => manager.get(id).status === "requires_action");

    const unknown = await http.request(`/sessions/${id}/approvals`, {
      body: JSON.stringify({ result: "allow", tool_use_id: "unknown" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unknown.status).toBe(409);
    expect(
      (
        await http.request("/sessions/missing/approvals", {
          body: JSON.stringify({ result: "allow", tool_use_id: "incident-1" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status
    ).toBe(404);

    const approval = await http.request(`/sessions/${id}/approvals`, {
      body: JSON.stringify({ result: "allow", tool_use_id: "incident-1" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await waitFor(() => manager.get(id).status === "completed");
    expect(approval.status).toBe(202);
  });

  it("API-006: interrupts an active model call", async () => {
    const { http, manager } = createApp({
      model: {
        complete: (request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true }
            );
          }),
      },
    });
    const created = await http.request("/sessions", {
      body: JSON.stringify({ objective: "Wait then interrupt" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const { id } = (await created.json()) as { id: string };
    await waitFor(() => manager.get(id).status === "running");
    const interrupted = await http.request(`/sessions/${id}/interrupt`, {
      method: "POST",
    });
    await waitFor(() => manager.get(id).status === "completed");

    expect(interrupted.status).toBe(202);
    expect(manager.get(id).stopReason).toBe("interrupted");
  });

  it("API-004: resumes from Last-Event-ID, receives live events once, and closes at terminal", async () => {
    const { http, manager } = createApp({
      model: {
        complete: () =>
          Promise.resolve({
            stopReason: "end_turn",
            text: "unused",
            toolCalls: [],
          }),
      },
    });
    const session = manager.create({ objective: "Stream test" });
    manager.sendEvent(session.id, {
      content: "before stream",
      type: "agent.message",
    });
    const response = await http.request(
      `/sessions/${session.id}/events/stream`,
      {
        headers: { "last-event-id": "1" },
      }
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await readSseEvent(reader);
    manager.sendEvent(session.id, { content: "live", type: "agent.message" });
    const second = await readSseEvent(reader);
    manager.sendEvent(session.id, {
      from: "queued",
      stopReason: "end_turn",
      to: "completed",
      type: "session.status",
    });
    const terminal = await readSseEvent(reader);
    const finalRead = await reader?.read();

    expect([first.seq, second.seq, terminal.seq]).toEqual([2, 3, 4]);
    expect(second.content).toBe("live");
    expect(terminal.type).toBe("session.status");
    expect(finalRead?.done).toBe(true);
  });

  it("API-004: streams loop-generated model spans to live subscribers", async () => {
    const { http, manager } = createApp({
      model: {
        complete: () =>
          Promise.resolve({
            stopReason: "end_turn",
            text: "answer",
            toolCalls: [],
          }),
      },
    });
    const session = manager.create({ objective: "Stream model span" });
    const response = await http.request(
      `/sessions/${session.id}/events/stream`
    );
    const reader = response.body?.getReader();
    const run = manager.run(session.id);
    const events = await readSseEvents(reader);
    await run;

    expect(events.map(({ type }) => type)).toContain("span.model_request");
    expect(events.at(-1)?.type).toBe("session.status");
  });
});

const waitFor = async (
  condition: () => boolean,
  attempt = 0
): Promise<void> => {
  if (condition()) {
    return;
  }
  if (attempt >= 100) {
    throw new Error("Condition did not become true");
  }
  await new Promise((resolve) => setTimeout(resolve, 1));
  return waitFor(condition, attempt + 1);
};

const readSseEvent = async (
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined
): Promise<{ content?: string; seq: number; type: string }> => {
  if (!reader) {
    throw new Error("Missing SSE reader");
  }
  const { done, value } = await reader.read();
  if (done || !value) {
    throw new Error("SSE stream ended before expected event");
  }
  const text = new TextDecoder().decode(value);
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) {
    throw new Error(`Invalid SSE frame: ${text}`);
  }
  return JSON.parse(data) as { content?: string; seq: number; type: string };
};

const readSseEvents = async (
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  events: Array<{ seq: number; type: string }> = []
): Promise<Array<{ seq: number; type: string }>> => {
  if (!reader) {
    throw new Error("Missing SSE reader");
  }
  const { done, value } = await reader.read();
  if (done || !value) {
    return events;
  }
  const text = new TextDecoder().decode(value);
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (data) {
    events.push(JSON.parse(data) as { seq: number; type: string });
  }
  return readSseEvents(reader, events);
};
