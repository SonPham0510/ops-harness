# Operations Agent Harness — Submission Report

## Overview
This project is a small operations assistant harness from to strach that accepts an objective , asks a model to reason and call tools, validates requests and responses, and records each run so it can be inspected or resumed. 
## Architecture and storage

![Operations Agent Harness architecture and workflow](assets/ops-agent-flow.visual-check.1440x900.light.png)

Open the [interactive workflow diagram](assets/ops-agent-flow.html) or inspect its [workflow source](assets/ops-agent-flow.workflow.json).


The CLI and HTTP API validate input and create sessions. `SessionManager` records events and coordinates the `AgentLoop`; the loop builds model history from the event log, validates model output, enforces limits, and executes tools in model order. Tool results return to the model, while `create_incident` suspends execution until an approval decision arrives.

Session state is projected from an append-only event log. The local implementation stores one JSONL event log per session under `.ops-agent-harness/`; there is no relational database. This keeps local runs inspectable and supports recovery, but does not provide database indexing or efficient multi-writer operation.
### Session lifecycle

```text
queued → running → completed       (the model finishes its turn)
                 → failed           (a limit or error stops the run)
                 → requires_action  (a tool needs approval)
                   → running        (all approval decisions are recorded)
running → paused → running          (recovered after a crash)
running → completed                 (interrupted; stopReason = interrupted)
```

## Technology stack

- TypeScript (strict mode), Bun, and Node.js 22 or newer.
- Hono and `@hono/node-server` for the HTTP API.
- The official `@openrouter/sdk` for model transport; the harness owns the tool-use loop.
- Zod for boundary validation; Commander for the CLI.
- Vitest for unit and integration tests; Ultracite for code checks.

## Mock tools and data

The project includes three local mock operations tools:

- `search_knowledge_base` searches seven in-source runbook entries.
- `get_service_status` returns seeded checkout, payments, and search status records.
- `create_incident` writes to an in-memory incident store and deduplicates retries by idempotency key. It requires approval before execution.

These fixtures are for development and demonstration; they are not connected to production systems.

## Environment variables

Copy `.env.example` to `.env` and set values as needed:

| Variable | Purpose | Default/example |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required when using the OpenRouter model. | Empty in the example; provide your own key. |
| `OPENROUTER_MODEL` | Model used when no request or CLI model ID overrides it. | `deepseek/deepseek-v4.1-flash` |

## Run and test

```bash
bun install
cp .env.example .env
# Add OPENROUTER_API_KEY to .env to use OpenRouter.
bun run dev -- run "Investigate payments" --model-id "deepseek/deepseek-v4.1-flash"  --approve allow
```

To start the HTTP API (requires `OPENROUTER_API_KEY` for model-backed sessions):

```bash
bun run dev -- serve --host 127.0.0.1 --port 8787
```

The automated suite covers successful model/tool execution, tool failures, approval suspend/resume, and execution limits, alongside event persistence, recovery, CLI, and API behavior. 
## Manual acceptance scenarios

Run these from a terminal after `bun install`.  The CLI prints the session ID and status to stderr; use that ID with `bun run dev -- trace <SESSION_ID>` to inspect the event log.

### Successful execution

```bash
bun run dev -- run "Check checkout health" --model-id "deepseek/deepseek-v4.1-flash"  
```

Expected: the session completes and the final answer says checkout is operational. The model calls the status and knowledge-base tools.

### Approval

To approve the incident automatically:

```bash
bun run dev -- run "Investigate payments" 
--model-id "deepseek/deepseek-v4.1-flash"  
--approve allow
```

Expected: the session completes with an incident ID. To exercise the interactive approval prompt, run this in a terminal and answer `yes` or `no` when asked:

```bash
bun run dev -- run "Investigate payments" --model-id "deepseek/deepseek-v4.1-flash"   --approve prompt
```

### Execution limit

```bash
bun run dev -- run "Check checkout health" --model-id "deepseek/deepseek-v4.1-flash"   --max-steps 1
```

Expected: the run stops at the configured step limit, reports a failed session, and exits with code `2`.

## Design choices and limitations

- **Append-only event log:** session state is projected from recorded events. The local implementation supports in-memory and JSONL logs. JSONL is easy to inspect and recover, but is not suited to large queries or many concurrent writers.
- **Custom tool-use loop:** the harness, not the SDK, controls validation, retries, timeouts, malformed responses, and execution limits.
- **Sequential tool calls:** calls run in the order returned by the model. This preserves ordering and approval behavior, but independent calls are not run in parallel.
- **Approval by suspend/resume:** the incident tool does not run until the user decides. Pending calls and decisions are recorded so the loop can resume in order.
- **Limited product scope:** there is no UI, authentication, production database, or multi-turn chat interface. The mock data and in-memory incident store are for local demos only.
