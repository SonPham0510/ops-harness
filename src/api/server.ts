import { Hono } from "hono";
import { z } from "zod";
import type { Metrics } from "@/core/observability/metrics.js";
import { summarize } from "@/core/observability/summary.js";
import {
  InvalidConfirmationError,
  type SessionManager,
  SessionNotFoundError,
} from "@/core/session/session-manager.js";
import type { SessionEvent } from "@/types/events.js";
import type { SessionStatus } from "@/types/session.js";

const positiveInt = z.number().int().positive().safe();
const SEQUENCE_PATTERN = /^\d+$/;
const LimitsSchema = z
  .object({
    maxIdenticalToolCalls: positiveInt,
    maxMalformedResponses: positiveInt,
    maxRunMs: positiveInt,
    maxSteps: positiveInt,
    maxToolCalls: positiveInt,
    modelMaxRetries: positiveInt,
    modelTimeoutMs: positiveInt,
  })
  .partial();

const CreateSessionSchema = z.object({
  approvalPolicy: z.enum(["manual", "auto_deny", "auto_allow"]).optional(),
  limits: LimitsSchema.optional(),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value.trim().length > 0)
    .optional(),
  objective: z.string().min(1).max(4000),
});
const ApprovalSchema = z.object({
  deny_message: z.string().optional(),
  result: z.enum(["allow", "deny"]),
  tool_use_id: z.string().min(1),
});

export const createHttpServer = (options: {
  manager: SessionManager;
  metrics: Metrics;
}) => {
  const app = new Hono();

  app.get("/healthz", (context) => context.json({ ok: true }));
  app.get("/metrics", (context) =>
    context.text(options.metrics.render(), 200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    })
  );
  app.post("/sessions", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = CreateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: parsed.error.flatten() }, 400);
    }
    const session = options.manager.create({
      ...(parsed.data.approvalPolicy === undefined
        ? {}
        : { approvalPolicy: parsed.data.approvalPolicy }),
      ...(parsed.data.limits === undefined
        ? {}
        : { limits: parsed.data.limits }),
      ...(parsed.data.modelId === undefined
        ? {}
        : { modelId: parsed.data.modelId }),
      objective: parsed.data.objective,
    });
    setTimeout(() => {
      options.manager
        .run(session.id, parsed.data.limits)
        .catch(() => undefined);
    }, 0);
    return context.json({ id: session.id, status: "queued" }, 201);
  });
  app.get("/sessions/:id", (context) => {
    try {
      const session = options.manager.get(context.req.param("id"));
      const summary = summarize(options.manager.events(session.id));
      return context.json({ session, summary });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.json({ error: "Session not found" }, 404);
      }
      throw error;
    }
  });
  app.get("/sessions/:id/events", (context) => {
    const cursor = context.req.query("after_seq");
    let afterSeq = 0;
    if (cursor !== undefined) {
      if (!SEQUENCE_PATTERN.test(cursor)) {
        return context.json(
          { error: "after_seq must be a non-negative integer" },
          400
        );
      }
      afterSeq = Number(cursor);
      if (!Number.isSafeInteger(afterSeq)) {
        return context.json({ error: "after_seq must be a safe integer" }, 400);
      }
    }
    try {
      return context.json({
        events: options.manager.events(context.req.param("id"), afterSeq),
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.json({ error: "Session not found" }, 404);
      }
      throw error;
    }
  });
  app.post("/sessions/:id/approvals", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = ApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: parsed.error.flatten() }, 400);
    }
    const id = context.req.param("id");
    try {
      const session = options.manager.get(id);
      if (!session.pendingToolUseIds.includes(parsed.data.tool_use_id)) {
        return context.json(
          { error: "Tool use is not awaiting approval" },
          409
        );
      }
      setTimeout(() => {
        options.manager
          .confirm(id, {
            ...(parsed.data.deny_message === undefined
              ? {}
              : { denyMessage: parsed.data.deny_message }),
            result: parsed.data.result,
            toolUseId: parsed.data.tool_use_id,
          })
          .catch(() => undefined);
      }, 0);
      return context.json({ status: "accepted" }, 202);
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.json({ error: "Session not found" }, 404);
      }
      if (error instanceof InvalidConfirmationError) {
        return context.json(
          { error: "Tool use is not awaiting approval" },
          409
        );
      }
      throw error;
    }
  });
  app.post("/sessions/:id/interrupt", (context) => {
    const id = context.req.param("id");
    try {
      options.manager.get(id);
      options.manager.interrupt(id);
      return context.json({ status: "interrupt requested" }, 202);
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.json({ error: "Session not found" }, 404);
      }
      throw error;
    }
  });
  app.get("/sessions/:id/events/stream", (context) => {
    const id = context.req.param("id");
    const headerCursor = context.req.header("last-event-id");
    let cursor = 0;
    if (headerCursor !== undefined) {
      if (!SEQUENCE_PATTERN.test(headerCursor)) {
        return context.json(
          { error: "Last-Event-ID must be a non-negative integer" },
          400
        );
      }
      cursor = Number(headerCursor);
      if (!Number.isSafeInteger(cursor)) {
        return context.json(
          { error: "Last-Event-ID must be a safe integer" },
          400
        );
      }
    }
    let firstBackfill: SessionEvent[];
    try {
      firstBackfill = options.manager.events(id, cursor);
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.json({ error: "Session not found" }, 404);
      }
      throw error;
    }

    let unsubscribe: (() => void) | undefined;
    let closed = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        closed = true;
        unsubscribe?.();
      },
      start: (controller) => {
        const emit = (event: SessionEvent): void => {
          if (closed || event.seq <= cursor) {
            return;
          }
          cursor = event.seq;
          controller.enqueue(
            encoder.encode(
              `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
            )
          );
          if (event.type === "session.status" && isTerminalStatus(event.to)) {
            closed = true;
            unsubscribe?.();
            controller.close();
          }
        };
        unsubscribe = options.manager.subscribe(id, emit);
        for (const event of firstBackfill) {
          emit(event);
        }
        for (const event of options.manager.events(id, cursor)) {
          emit(event);
        }
        if (isTerminalStatus(options.manager.get(id).status) && !closed) {
          closed = true;
          unsubscribe();
          controller.close();
        }
      },
    });
    return context.newResponse(stream, 200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
  });

  return app;
};

const isTerminalStatus = (status: SessionStatus): boolean =>
  status === "completed" || status === "failed";
