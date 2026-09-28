import { join } from "node:path";
import { type ServerType, serve } from "@hono/node-server";
import { Command, CommanderError, Option } from "commander";
import { createApp } from "@/app.js";
import { JsonlEventLog } from "@/core/events/jsonl-event-log.js";
import { summarize } from "@/core/observability/summary.js";
import { projectSession } from "@/core/session/project-session.js";
import { DemoModel } from "@/model/demo.js";
import type { ModelClient } from "@/model/model.js";
import { OpenRouterModel } from "@/model/openrouter.js";
import type { SessionEvent } from "@/types/events.js";

export interface CliIO {
  dataDir?: string;
  isTTY?: boolean;
  onServe?: (port: number, close: () => void) => void;
  openRouterModel?: ModelClient;
  prompt?: (message: string) => Promise<string>;
  stderr: (text: string) => void;
  stdout: (text: string) => void;
}

export const runCli = async (argv: string[], io: CliIO): Promise<number> => {
  const root = new Command()
    .name("ops-agent")
    .exitOverride()
    .configureOutput({
      outputError: (text) => io.stderr(text),
      writeErr: (text) => io.stderr(text),
      writeOut: (text) => io.stdout(text),
    });
  let exitCode = 0;

  root
    .command("run")
    .argument("<objective>")
    .addOption(
      new Option("--model <model>")
        .choices(["demo", "openrouter"])
        .default("openrouter")
    )
    .option("--model-id <id>")
    .addOption(
      new Option("--approve <mode>").choices(["prompt", "allow", "deny"])
    )
    .option("--max-steps <n>", "maximum model steps", parsePositiveInteger)
    .option("--timeout-ms <n>", "session timeout", parsePositiveInteger)
    .option("--chaos", "inject demo tool faults")
    .option("--data-dir <path>")
    .action(async (objective: string, options: RunOptions) => {
      exitCode = await executeRun(objective, options, io);
    });

  root
    .command("show")
    .argument("<sessionId>")
    .option("--data-dir <path>")
    .action((sessionId: string, options: { dataDir?: string }) => {
      try {
        const { eventLog } = loadEventLog(options.dataDir, io);
        const events = eventLog.getEvents(sessionId);
        const session = projectSession(events);
        const summary = summarize(events);
        io.stdout(`${JSON.stringify({ session, summary })}\n`);
      } catch (error) {
        io.stderr(
          `${error instanceof Error ? error.message : String(error)}\n`
        );
        exitCode = 2;
      }
    });

  root
    .command("trace")
    .argument("<sessionId>")
    .option("--json", "emit raw JSONL events")
    .option("--data-dir <path>")
    .action(
      (sessionId: string, options: { dataDir?: string; json?: boolean }) => {
        try {
          const { eventLog } = loadEventLog(options.dataDir, io);
          const events = eventLog.getEvents(sessionId);
          if (options.json) {
            io.stdout(
              `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
            );
          } else {
            io.stdout(
              `${events.map((event) => `${event.seq} ${event.createdAt} ${event.type} ${traceDetail(event)}`).join("\n")}\n`
            );
          }
        } catch (error) {
          io.stderr(
            `${error instanceof Error ? error.message : String(error)}\n`
          );
          exitCode = 2;
        }
      }
    );

  root
    .command("serve")
    .option("--port <port>", "port to bind", parsePort, 8787)
    .option("--host <host>", "host to bind", "127.0.0.1")
    .option("--data-dir <path>")
    .action((options: { dataDir?: string; host: string; port: number }) => {
      try {
        const { http } = createApp({
          dataDir:
            options.dataDir ??
            io.dataDir ??
            join(process.cwd(), ".ops-agent-harness"),
          model: io.openRouterModel ?? new OpenRouterModel(),
        });
        let server: ServerType | undefined;
        server = serve(
          { fetch: http.fetch, hostname: options.host, port: options.port },
          ({ port }) => {
            io.stderr(`Listening on http://${options.host}:${port}\n`);
            io.onServe?.(port, () => server?.close());
          }
        );
      } catch (error) {
        io.stderr(
          `${error instanceof Error ? error.message : String(error)}\n`
        );
        exitCode = 2;
      }
    });

  try {
    await root.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      exitCode = error.exitCode === 0 ? 0 : 2;
    } else {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      exitCode = 2;
    }
  }
  return exitCode;
};

interface RunOptions {
  approve?: "allow" | "deny" | "prompt";
  chaos?: boolean;
  dataDir?: string;
  maxSteps?: number;
  model: "demo" | "openrouter";
  modelId?: string;
  timeoutMs?: number;
}

const selectModel = (model: RunOptions["model"], io: CliIO): ModelClient => {
  if (model === "demo") {
    return new DemoModel();
  }
  return io.openRouterModel ?? new OpenRouterModel();
};

const executeRun = async (
  objective: string,
  options: RunOptions,
  io: CliIO
): Promise<number> => {
  if (options.model === "demo" && options.modelId) {
    io.stderr("--model-id requires --model openrouter\n");
    return 2;
  }
  if (objective.length < 1 || objective.length > 4000) {
    io.stderr("Objective must contain 1 to 4000 characters\n");
    return 2;
  }
  try {
    const model = selectModel(options.model, io);
    const approvalPolicy = selectApprovalPolicy(options.approve, io.isTTY);
    const { manager } = createApp({
      approvalPolicy,
      dataDir:
        options.dataDir ??
        io.dataDir ??
        join(process.cwd(), ".ops-agent-harness"),
      model,
    });
    let session = await manager.start({
      approvalPolicy,
      limits: {
        ...(options.maxSteps === undefined
          ? {}
          : { maxSteps: options.maxSteps }),
        ...(options.timeoutMs === undefined
          ? {}
          : { maxRunMs: options.timeoutMs }),
      },
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      objective,
    });
    if (session.status === "requires_action" && approvalPolicy === "manual") {
      session = await promptForApprovals(manager, session, io);
    }
    io.stderr(`Session ${session.id}: ${session.status}\n`);
    if (session.finalAnswer) {
      io.stdout(`${session.finalAnswer}\n`);
    }
    return session.status === "completed" ? 0 : 2;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
};

const selectApprovalPolicy = (
  approve: RunOptions["approve"],
  isTTY: boolean | undefined
): "manual" | "auto_deny" | "auto_allow" => {
  if (approve === "allow") {
    return "auto_allow";
  }
  if (approve === "deny" || !isTTY) {
    return "auto_deny";
  }
  return "manual";
};

const promptForApprovals = async (
  manager: ReturnType<typeof createApp>["manager"],
  initial: Awaited<ReturnType<typeof manager.start>>,
  io: CliIO
) => promptApprovalAt(manager, initial, initial.pendingToolUseIds, 0, io);

const promptApprovalAt = async (
  manager: ReturnType<typeof createApp>["manager"],
  session: Awaited<ReturnType<typeof manager.start>>,
  toolUseIds: string[],
  index: number,
  io: CliIO
): Promise<Awaited<ReturnType<typeof manager.start>>> => {
  const toolUseId = toolUseIds[index];
  if (!toolUseId) {
    return session;
  }
  const tool = manager
    .events(session.id)
    .find(
      (event) =>
        event.type === "agent.tool_use" && event.toolUseId === toolUseId
    );
  if (tool?.type !== "agent.tool_use") {
    return promptApprovalAt(manager, session, toolUseIds, index + 1, io);
  }
  io.stderr(`Approve ${tool.name}? ${JSON.stringify(tool.input)}\n`);
  const answer = await io.prompt?.(`Approve ${tool.name}? [y/N] `);
  const result =
    answer?.trim().toLowerCase() === "y" ||
    answer?.trim().toLowerCase() === "yes"
      ? "allow"
      : "deny";
  const next = await manager.confirm(session.id, { result, toolUseId });
  return promptApprovalAt(manager, next, toolUseIds, index + 1, io);
};

const parsePositiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer");
  }
  return parsed;
};

const parsePort = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("Port must be an integer from 0 to 65535");
  }
  return parsed;
};

const loadEventLog = (dataDir: string | undefined, io: CliIO) => {
  const directory =
    dataDir ?? io.dataDir ?? join(process.cwd(), ".ops-agent-harness");
  return { directory, eventLog: new JsonlEventLog(join(directory, "events")) };
};

const traceDetail = (event: SessionEvent): string =>
  JSON.stringify(event, (key, value: unknown) =>
    ["createdAt", "id", "seq", "sessionId", "type"].includes(key)
      ? undefined
      : value
  );
