# Ledger

Mỗi task một dòng: `T<id> | done | <test đã thấy đỏ → xanh> | <lệnh verify + kết quả>`.
Mọi lần lệch khỏi plan: `Ruling: <quyết định> — <lý do> — <cái giá nếu sai>`.

## M1

## M2

- T2.13 | done | `ops-tools.test.ts` RED: module faults thiếu → GREEN 8/8 (OPS-005 error retryable → attempts 2; errorAfterCommit + retry → deduplicated, store 1) | full gate exit 0, 10 files/45 tests pass; lint: default switch clause, không dùng `void`
- T2.12 | done | `ops-tools.test.ts` RED: module incidents thiếu → GREEN 6/6 (OPS-003 requiresApproval + tạo incident; OPS-004 cùng key → deduplicated, store size 1) | full gate exit 0, 10 files/43 tests pass; sửa `#nextId` thành method `nextId()` cho id đúng thứ tự
- T2.11 | done | `ops-tools.test.ts` RED: module thiếu (suite fail) → GREEN 4/4 (OPS-001 rank + ≤5; OPS-002 known/unknown/invalid) | full gate exit 0, 10 files/41 tests pass; lint: regex top-level, bỏ async dùng `Promise.resolve`
- T2.10 | done | `TOOL-008` mutation-check RED: tự thêm `:attempt` vào key → keys khác nhau (1 fail) → khôi phục truyền nguyên ctx → GREEN 3 keys giống nhau | full gate exit 0, 9 files/37 tests pass
- T2.9 | done | `TOOL-010` RED: abort giữa chừng → handler reject Error → bị map execution_error retryable (test timeout) → GREEN: kiểm tra `ctx.signal.aborted` trước attempt và trong catch, trả `aborted` attempts 1 | full gate exit 0, 9 files/36 tests pass
- T2.8 | done | `TOOL-005` RED: handler treo (test timeout 1000ms) → GREEN: `AbortSignal.any` + `withTimeout` race, abort đúng tín hiệu, attempts 2 | full gate exit 0, 9 files/35 tests pass
- T2.7 | done | `TOOL-006`/`TOOL-007` mutation-check RED: bỏ điều kiện retry → calls 3 thay vì 1 (2 fail) → khôi phục điều kiện → GREEN | full gate exit 0, 9 files/34 tests pass
- T2.6 | done | `TOOL-004` + `TOOL-011` RED: retry không có / plain Error không map execution_error → GREEN (fail 2 lần rồi ok, attempts 3, delays [10,20] với `random: () => 0.5`; plain Error retry thành công sau 1 lần) | full gate exit 0, 9 files/32 tests pass
- T2.1 | done | `registry.test.ts` RED: module `@/core/tools/{registry,errors}` chưa tồn tại → GREEN 2/2 (specs() function-tool + JSON Schema parameters/required; ToolError code/retryable) | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 8 files/26 tests pass
- T2.2 | done | `tool-executor.test.ts` RED: executor module thiếu → GREEN 1/1 (inspect/run unknown tool cùng outcome, liệt kê valid tools) | full gate exit 0, 9 files/27 tests pass
- T2.3 | done | `TOOL-002` RED: invalid input chạy handler (ok:true) → GREEN 2/2 (inspect/run cùng invalid_input, handlerCalls=0, content có tên trường) | full gate exit 0, 9 files/28 tests pass
- T2.4 | done | `TOOL-009` RED: content 211 chars không truncate → GREEN (prefix cắt 50 + `[truncated 211 chars]`, output giữ nguyên) | full gate exit 0, 9 files/29 tests pass
- T2.5 | done | `TOOL-003` RED: output sai schema trả ok:true → GREEN (invalid_output, retryable false, content không lộ data sai, attempts 1) | full gate exit 0, 9 files/30 tests pass

- T1.0 | done | `tests/unit/smoke.test.ts` đỏ (không resolve được `@/index.js`) → xanh | `bun run test` 1/1 pass, `bun run typecheck` sạch
- T1.1 | done | `state-machine.test.ts` RED: module/InvalidTransitionError/canTransition thiếu → GREEN 3/3 | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 2 files/4 tests pass
- T1.2 | done | `SES-002` table RED: `isTerminal` thiếu (6 fail) → GREEN 9/9 targeted | full gate exit 0, 2 files/10 tests pass
- T1.3 | done | `event-log.test.ts` RED→GREEN qua 4 lát: append metadata, modelId validation, strict payload, immutable nested input/no mutation API | full gate exit 0, 3 files/14 tests pass
- T1.4 | done | `EVT-002` RED: afterSeq bị bỏ qua → GREEN 5/5 targeted | full gate exit 0, 3 files/15 tests pass
- T1.5 | done | `jsonl-event-log.test.ts` RED→GREEN: persist/reopen/seq/list và typed InvalidEventLogError | full gate exit 0, 4 files/17 tests pass
- T1.6 | done | `EVT-005` RED: projection module thiếu → GREEN user + grouped assistant toolCalls + từng tool result/error JSON | full gate exit 0, 5 files/18 tests pass
- T1.7 | done | `EVT-005` RED→GREEN: raw assistant giữ nguyên, correction thành user, metadata events bị bỏ qua | full gate exit 0, 5 files/21 tests pass
- T1.8 | done | `EVT-006` RED: recovery module thiếu → GREEN orphan B sau result A, empty input → empty | full gate exit 0, 6 files/22 tests pass
- T1.9 | done | `EVT-007` RED→GREEN: projected model/status/partial approvals/final answer + typed missing-created error | full gate exit 0, 7 files/24 tests pass
- Ruling: bỏ `baseUrl` khỏi tsconfig — TypeScript 7 đã bỏ option này, `paths` vẫn resolve tương đối theo tsconfig — nếu sai thì alias `@/` hỏng lúc typecheck (sẽ thấy ngay)
- Ruling: seam S1–S8 giữ như trong AGENTS.md — người dùng chưa phản đối, chuyển việc thực thi sang Codex — nếu muốn gọn hơn thì bỏ S1/S2 và chỉ test gián tiếp qua S4/S5
- Ruling (superseded): scope assessment từng chọn CLI và seam S1–S7; quyết định này được thay bởi ruling khôi phục full showcase bên dưới
- Ruling: thêm `ToolExecutor.inspect` và `projectSession` — approval cần validate không side effect và state phải thật sự suy ra từ log — cái giá là thêm hai interface công khai phải duy trì
- Ruling: khôi phục full showcase API + CLI, SSE, metrics, auto-approval và crash recovery theo yêu cầu người dùng — giữ nguyên brief và kiến trúc nâng cao ban đầu — cái giá là phạm vi lớn hơn minimum assessment
- Ruling: thay Anthropic compatibility layer bằng SDK chính thức `@openrouter/sdk` và Chat Completions wire format — cho phép mọi OpenRouter model id, đúng yêu cầu người dùng và tránh khóa adapter vào Anthropic Messages — cái giá là projection/tool schema và test M1/M2/M6/M7 phải theo contract mới
- Verification (OpenRouter SDK migration) | `bun run fix` sạch; `bun run check && bun run typecheck && bun run test` exit 0 (1 file, 1 test pass); SDK smoke xác nhận `client.chat.send` tồn tại; không còn dependency/reference `@anthropic-ai/sdk`
- Ruling: persist `modelId` trong `session.created` và truyền qua projector/loop/adapter — API override phải ổn định qua mọi step và crash recovery — cái giá là event/snapshot interface thêm một field optional
- Ruling: defer cả inspect-error result khi cùng step có approval — bảo toàn invariant không emit result sớm và thứ tự một-result-per-call — cái giá là pending-step executor phải giữ inspection outcome tới lúc resume
- Ruling: tắt retry nội bộ của `@openrouter/sdk` bằng request option `retries: { strategy: 'none' }` — AgentLoop phải sở hữu retry để span/limit phản ánh từng attempt — cái giá là adapter phải luôn truyền option này
- Ruling: map SDK `ResponseValidationError` và lỗi parse assistant/tool arguments thành `ModelProtocolError` — malformed provider output phải đi qua correction budget thay vì bị báo nhầm `llm_error` — cái giá là model seam có thêm một error type công khai
- Spec/plan audit | 83/83 behavior IDs có plan; tracker và milestone detail cùng đủ 70 task; trạng thái 1 done + 69 todo, không task `doing`; task sẵn sàng tiếp theo T1.1
- Ruling: thực thi ngay trong workspace người dùng chỉ định, không dùng commit-range scripts của executing-plans — repo đang ở unborn `main`, toàn bộ scaffold untracked và AGENTS.md cấm commit khi chưa được phép — cái giá nếu sai là chưa có Git BASE cho từng task; bằng chứng RED/GREEN/verify vẫn ghi vào hai ledger

## M3

- T3.13 | done | `agent-loop.test.ts` RED: batch có approval chạy handler/result rồi ScriptedModel exhausted → GREEN: inspect toàn batch trước; suspend `tool_confirmation` mang pending step, emit tool_use nhưng defer toàn bộ handler/result | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 12 files/71 tests pass
- T3.12 | done | `agent-loop.test.ts` RED: tool bị abort nhưng loop vẫn gọi model lần 2 → GREEN: pre-model check external signal dừng `interrupted`, tool nhận abort signal | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 12 files/70 tests pass
- T3.11 | done | `agent-loop.test.ts` RED: equivalent inputs with đảo thứ tự key tiếp tục đến ScriptedModel exhausted → GREEN: stable stringify sort keys đếm tool name+input và dừng `loop_detected` trước handler cuối | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 12 files/69 tests pass
- T3.10 | done | `agent-loop.test.ts` RED: cả deadline chung và per-call timeout treo tới 500ms → GREEN: deadline abort signal dừng `timeout`; per-call timeout map `ModelError` retryable và hồi phục ở attempt sau | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 12 files/68 tests pass
- T3.9 | done | `LIM-001/LIM-004` RED: ScriptedModel exhausted vì không limit → GREEN: pre-model maxSteps và pre-execution maxToolCalls emit limit_hit, stop `max_steps` | full gate exit 0, 12 files/66 tests pass
- T3.8 | done | `LOOP-007/008` RED 3 cases: ModelError throw khỏi loop → GREEN recursive retry + injectable backoff; non-retryable/exhausted stop `llm_error` | full gate exit 0, 12 files/64 tests pass
- T3.7 | done | `LOOP-012` RED: refusal không gọi onStop → GREEN: dừng `refusal`, không emit agent event hay request thêm | full gate exit 0, 12 files/61 tests pass
- T3.6 | done | `LOOP-011` RED: malformed thứ hai vẫn correction và gọi model thứ ba → GREEN: đếm `harness.malformed_response` từ log, vượt limit thì stop trước request tiếp | full gate exit 0, 12 files/60 tests pass
- T3.5 | done | `LOOP-010` RED 7/7: protocol/schema/empty/max_tokens/duplicate-id/shape mismatch không correction → GREEN parameterized recovery; thêm event `harness.malformed_response` có `reason` | full gate exit 0, 12 files/59 tests pass
- T3.4 | done | `LOOP-005` mutation-check RED: ép `isError:false` → lỗi tool không được đánh dấu (1 fail) → khôi phục `!outcome.ok`, model nhận tool-error và tiếp tục | full gate exit 0, 12 files/52 tests pass
- T3.3 | done | `agent-loop.test.ts` RED: tool-use response không emit event → GREEN 2 cases (tool-only raw trên `agent.tool_use`; text+tool raw trên `agent.message`; tool_result vào request sau) | full gate exit 0, 12 files/51 tests pass
- T3.2 | done | `agent-loop.test.ts` RED: module AgentLoop thiếu → GREEN (LOOP-001 request chứa objective/tool specs/modelId; LOOP-002 text-only emit `agent.message`, stop end_turn) | full gate exit 0, 12 files/49 tests pass
- T3.1 | done | `scripted-model.test.ts` RED: ModelResponseSchema undefined → GREEN 3/3 (schema validate response; ScriptedModel trả step tuần tự, ghi đủ cả request exhausted, function step) | full gate exit 0, 11 files/48 tests pass

## M4

- T4.1 | done | `session-manager.test.ts` RED: SessionManager module missing → GREEN: create appends `session.created`, returns projected queued snapshot with persisted arbitrary modelId | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/72 tests pass
- T4.2 | done | `session-manager.test.ts` RED: `start` missing → GREEN: append user message, drive AgentLoop, project final answer and `queued → running → completed` | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/73 tests pass
- T4.3 | done | `session-manager.test.ts` RED: limit transitioned failed nhưng thiếu `session.error` → GREEN: validate/append typed `session.error` alongside failed stop transition | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/74 tests pass

## M5

- T5.1 | done | `agent-loop.test.ts` RED: retries had no `span.model_request` entries → GREEN: one validated span per attempt with own duration, error retryability, response tokens and stop reason | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/90 tests pass
- T5.2 | done | `agent-loop.test.ts` RED: retried tool had no per-attempt trace → GREEN: ToolExecutor callback writes `span.tool_attempt` for upstream error and success including independent duration | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/91 tests pass
- T5.3 | done | Existing integration tests verify each status transition and typed `session.error` on failure from T4.2/T4.3; no implementation gap remained | full gate exit 0, 13 files/91 tests pass
- T5.4 | done | `summary.test.ts` RED: summarize module missing → GREEN literal aggregate verifies status/stop, steps, tools, errors, approvals, model tokens and event duration | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 14 files/92 tests pass
- T5.5 | done | `logger.test.ts` RED: logger module missing → GREEN JSON line with child field merge and level filtering; trace content is persisted by event log and approval integration tests | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 15 files/94 tests pass
- T5.6 | done | `metrics.test.ts` RED: collector missing → GREEN Prometheus counters/histogram and real AgentLoop request/session hooks | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 16 files/96 tests pass
- T6.1 | done | `openrouter-model.test.ts` RED: adapter missing → GREEN request shape, signal/retries:none and request→constructor→env→default model precedence; fake SDK only, no network | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 17 files/98 tests pass
- T6.2 | done | `openrouter-model.test.ts` RED: 3 mapping tests fail → GREEN raw assistant, text/parts, parsed object tool calls, usage, refusal/finish reasons, empty-choice and malformed-argument protocol errors | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 17 files/101 tests pass
- T6.3 | done | `openrouter-model.test.ts` RED: 3 typed-error mapping tests fail → GREEN caller abort identity, retryable SDK transport/HTTP statuses, permanent statuses, response protocol errors and permanent SDK request validation errors | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 17 files/104 tests pass
- T6.4 | done | `demo-model.test.ts` RED: DemoModel module missing → GREEN S5 run through real AgentLoop/SessionManager: degraded payments → status → KB → auto-approved incident → answer with incident id; operational checkout skips incident | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 18 files/106 tests pass
- T7.1 | done | `api.test.ts` RED: app composition/HTTP module missing → GREEN POST async create, zod body/limits validation, persisted/forwarded arbitrary modelId on each step, applied per-session limits, GET summary/404, healthz, metrics | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 19 files/110 tests pass
- T7.2 | done | `api.test.ts` RED: events endpoint returned not-found HTML → GREEN JSON `events` with `after_seq` filter, cursor validation and unknown-session 404 | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 19 files/111 tests pass
- T7.3 | done | `api.test.ts` RED: approval/interrupt routes missing → GREEN approved create_incident resumes to completed; unknown pending id 409, missing session 404; active call interrupt reaches interrupted | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 19 files/113 tests pass
- T7.4 | done | `api.test.ts` RED: SSE route missing → GREEN Last-Event-ID backfill, subscribe+second backfill with seq dedupe, live event delivery (including loop-generated model spans), terminal close | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, final full gate 20 files/122 tests pass
- T7.5 | done | `cli.test.ts` RED: `runCli` module missing → GREEN offline DemoModel, injectable OpenRouter modelId forwarding, demo/modelId usage error and completed/failed exit codes | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 20 files/117 tests pass
- T7.6 | done | `cli.test.ts` verifies prompt `yes` allows, `no` denies, and no-TTY/no-option defaults to deny without prompting | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 20 files/118 tests pass
- T7.7 | done | `cli.test.ts` verifies persisted `show` summary, human timeline, JSONL trace, and real `serve --port 0` healthz response; added `src/cli/main.ts` process IO entrypoint | `bun run fix && bun run check && bun run typecheck` exit 0; `bun run test` outside sandbox (localhost permission) exit 0, final 20 files/122 tests pass
- T4.4 | done | `session-manager.test.ts` RED: terminal sendEvent/runTurn missing → GREEN: SessionTerminalError guard and per-session promise chain preserve sequential turn event order | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/76 tests pass
- T4.5 | done | `session-manager.test.ts` RED: loop suspended but projected pending id empty/no approval request → GREEN: persist validated requiresApproval calls from pending-step detail, status requires_action, handler untouched | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/77 tests pass
- T4.6 | done | `session-manager.test.ts` coverage: invalid-only approval tool yields isError/no approval/no handler; mixed invalid+valid approval stays pending without early result | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/79 tests pass
- T4.7 | done | `session-manager.test.ts` RED: confirm method missing → GREEN: append user confirmation/decision, await all pending ids, resume stored ordered step, execute allowed tool and continue to final answer | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/80 tests pass
- T4.8 | done | `session-manager.test.ts` RED→GREEN: deny path skips handler, emits isError tool result with denyMessage, and next model request receives it | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/81 tests pass
- T4.9 | done | `session-manager.test.ts` RED: InvalidConfirmationError missing → GREEN: unknown pending id rejects before appending any event or changing pending projection | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/82 tests pass
- T4.10 | done | `session-manager.test.ts` RED→GREEN: reverse decisions leave first approval pending with no handlers; final decision runs tools and emits results in original order | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/83 tests pass
- T4.11 | done | `session-manager.test.ts` RED: auto_allow policy unsupported → GREEN ordered allow path; final audit adds auto_deny coverage proving policy denial skips handler and emits error result | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 20 files/122 tests pass
- T4.12 | done | `session-manager.test.ts` RED: manager had no active run/interrupt API → GREEN: create+run path passes abort signal, AgentLoop maps model abort to interrupted and session completes accordingly | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/85 tests pass
- T4.13 | done | `session-manager.test.ts` RED: recover missing → GREEN: Jsonl recovery rebuilds partial approval and modelId, reconciles orphan tool results around running→paused→running, resumes next loop step | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/87 tests pass
- T4.14 | done | `session-manager.test.ts` integration coverage: errorAfterCommit triggers retry after approval; dedupe leaves one incident and one result | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/88 tests pass
- T4.15 | done | `session-manager.test.ts` RED: subscribe API missing → GREEN: live append notification, seq-ordered no duplicates, unsubscribe stops delivery, unknown session typed error | `bun run fix && bun run check && bun run typecheck && bun run test` exit 0, 13 files/90 tests pass

## M8

- T8.1 | done | README covers offline/OpenRouter quickstart, CLI/API, explicit approval policy, session lifecycle, trace, architecture and trade-offs; offline demo and explicit incident flow commands verified | Archify workflow showcase 9/9 checks, 0 errors/warnings; Chrome visual-check passed containment at 1440×900, 1600×1000, 1920×1080 and 2048×1320 (light/dark captures)
- T8.2 | done | `spec-coverage.test.ts` RED: missing checker then fixture failures for abbreviation, suffix, comments and strings → GREEN 3/3 including `it.each(cases)` and apostrophe titles; expanded abbreviated test names to full IDs | `bun run fix` exit 0; `bun run verify` exit 0: check + typecheck, 21 files/125 tests pass, 83/83 IDs covered
- Final review | independent M8 review found and verified fixes for coverage false positives, incident quickstart accuracy, and explicit session lifecycle; no remaining Critical/Important findings
