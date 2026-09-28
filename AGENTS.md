# AGENTS.md — ops-agent-harness

> Shared instructions for Codex (reads `AGENTS.md`) and Claude Code (`CLAUDE.md` only contains `@AGENTS.md`).

This is an Agent Harness for an **operations assistant**. It receives an objective from the CLI/API, runs an LLM ↔ tool loop, validates all inputs and outputs, stores state and an event log, handles errors/timeouts/retries/malformed responses, prevents infinite loops, requires approval before `create_incident`, and generates a trace for every run.

## Commands

```bash
bun run test                 # run all tests with Vitest
bunx vitest run tests/unit/tool-executor.test.ts   # run one test file
bun run typecheck            # tsc --noEmit (src + tests)
bun run dev -- run "objective" --model demo --approve prompt
bun run dev -- serve --port 8787
```

Before reporting any task as complete, run `bun run fix` after code changes, then ensure
`bun run check && bun run typecheck && bun run test` passes.

## Code map

```
src/
  types/            session.ts (status, transitions, stopReason) · events.ts · tool.ts
  core/session/     state-machine · session-manager · executor · events-to-messages · session-recovery · project-session
  core/events/      event-log.ts (InMemoryEventLog, JsonlEventLog)
  core/loop/        agent-loop.ts (custom loop) · limits.ts (steps / deadline / loop guard)
  core/tools/       registry.ts · executor.ts (timeout, retry, output validation) · errors.ts (ToolError)
  core/approval/    confirmation.ts (handles user.tool_confirmation)
  core/observability/ logger.ts · metrics.ts · summary.ts
  model/            model.ts (ModelClient + ModelResponseSchema) · openrouter.ts · scripted.ts · demo.ts
  tools/ops/        search_knowledge_base · get_service_status · create_incident · faults.ts
  api/server.ts     Hono: sessions, events (SSE), approval
  cli/program.ts    Commander: run · serve · show · trace
docs/specs/         SPEC — source of truth for behavior (IDs such as LOOP-003)
docs/plans/         Milestone plans, with small tasks and status
tests/unit/ tests/integration/
```

One-way dependencies: `api|cli → core/session → core/loop → core/tools, model → types`.
`core/loop` must not know about HTTP, the file system, or `SessionManager`.

## Workflow: Spec → Plan → TDD

1. **Spec first.** Every behavior must have an ID in `docs/specs/*.md` (for example, `TOOL-004`).
   A behavior change means editing the spec first, then the test/code.
2. **Take the next task** from `docs/plans/README.md`: the first task with `todo` status whose dependencies are `done`. Do not work on multiple tasks in parallel.
3. **Red → Green in vertical slices.** Each cycle: one test → the minimum code needed to pass → repeat.
   - Include the spec ID in the test name: `it('TOOL-004: retries retryable errors with backoff', ...)`.
   - Run the test and **see it fail for the expected reason** before writing code.
   - Do not write a batch of tests in advance; do not add behavior the test does not require.
4. **Refactor** only after the tests are green, during the task review step—not during the red/green cycle.
5. **Close the task:** typecheck and tests pass → mark it `done` in `docs/plans/README.md` → add one line to `docs/plans/LEDGER.md`. **Do not commit** until the user allows it; when allowed, make one commit per task, for example `feat(M2/T2.3): ...`.

### Using Superpowers (Codex)

The plan is already written—do **not** rerun `brainstorming` or `writing-plans`.

| When | Skill |
|---|---|
| Execute the plan, task by task | `superpowers:executing-plans` (plan = `docs/plans/M*.md`, spec = `docs/specs/*.md`, ledger = `docs/plans/LEDGER.md`) |
| Each task | `superpowers:test-driven-development` — see the test fail for the expected reason before coding |
| Before marking a task `done` | `superpowers:verification-before-completion` — run `bun run check && bun run typecheck && bun run test`, and paste the results into the ledger |
| A red test fails for an unclear reason | `superpowers:systematic-debugging` |
| After each milestone | `superpowers:requesting-code-review` on the milestone diff |

When instructions conflict, priority is **spec > AGENTS.md > plan > judgment**. Whenever you deviate from the plan, record
`Ruling: <decision> — <reason> — <cost if wrong>` in the ledger.

### Seams (test only these public interfaces)

| Seam | Interface | Test type |
|---|---|---|
| S1 | `transition / canTransition / isTerminal` | unit |
| S2 | `EventLog` + `eventsToMessages()` + `findOrphanedToolUses()` + `projectSession()` | unit |
| S3 | `ToolExecutor.inspect(call)` + `run(call, ctx)` with `ToolRegistry` | unit |
| S4 | `AgentLoop.execute(ctx)` with `ScriptedModel` — the primary seam | unit/integration |
| S5 | `SessionManager` (create · sendEvent · get · events · subscribe), including approval flow | integration |
| S6 | `OpenRouterModel.complete()` with a fake SDK client | unit |
| S7 | Hono `app.request()` | integration |
| S8 | `runCli(argv, io)` with fake IO | integration |

Do not test private functions or mock internal collaborators. Use fakes only at external boundaries: the model
(`ScriptedModel`), SDK client, clock/deadline (small `now`/timeout parameters), and mock tool backends.

## Code conventions

- TypeScript strict mode, ESM, Node ≥ 22. Import internal modules through the `@/…` alias and use the `.js` extension.
- Validate every boundary with **Zod**: tool input/output, model response, HTTP body, CLI input, and JSONL event.
- Use typed errors: `ToolError { code, retryable }`, `ModelError { retryable }`,
  `ModelProtocolError { detail, raw? }`.
  **Never** detect errors by comparing message strings.
- A tool error → `agent.tool_result` with `isError: true` (never return a fake-success string such as `"Error:"`).
- The event log is **append-only**; session state is derived from the log. Never modify or delete old events.
- An invalid transition must **throw** `InvalidTransitionError` (never silently ignore it).
- Every event duration measures **only its own span**; do not accumulate durations.
- Every operation that may hang must accept an `AbortSignal`.
- Put limits in `HarnessLimits`, with defaults that can be overridden through the CLI/API.
- Do not add dependencies beyond: `@openrouter/sdk`, `zod`, `hono`, `@hono/node-server`,
  `commander`, `nanoid`
  (dev: `typescript`, `tsup`, `vitest`, `@types/node`, `@biomejs/biome`,
  `ultracite`, `husky`, `lint-staged`).

## Model

- The default provider is OpenRouter, with model `deepseek/deepseek-v4.1-flash`. Accept any non-empty OpenRouter
  model ID. Override precedence: API request / `--model-id` → `OPENROUTER_MODEL` → default.
  Read the API key from `OPENROUTER_API_KEY`.
- Use the official `@openrouter/sdk` and call `client.chat.send`. The SDK is transport only: implement the tool-use
  loop yourself; the default tool choice is auto. Store the original assistant message unchanged and send it
  unchanged in the next request.
- `--model demo` selects the rule-based `DemoModel`, which runs offline and needs no API key.
- Tests must **never** call a real API.

## Out of scope / prohibited

- Do not add a sandbox, database, authentication, UI, or multiple providers; these are out of scope.
- Do not use `--no-verify`; do not skip tests or use `.only` when committing.
- Do not change the spec to match incorrect code.
