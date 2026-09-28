# M3 — Agent loop tự viết

**Goal:** `AgentLoop.execute(ctx)` thay cho `streamText`, xử lý đủ nhánh của SPEC 03.
**Seam:** S4. Test dựng `ctx` với `InMemoryEventLog`, `ScriptedModel`, registry có tool giả,
thu event được yield + `stopReason` qua `ctx.onStop`.

Helper test (viết ở T3.2, dùng lại): `runLoop({ steps, tools?, limits? }) → { events, stop, model }`.

| Task | Test đỏ (tên) | Điểm cần có trong code |
|---|---|---|
| T3.1 | `MDL-005: ScriptedModel returns steps in order, records requests, throws when exhausted` | `src/model/{model,scripted}.ts`, `ModelResponseSchema`, `ModelError` |
| T3.2 | `LOOP-002: text-only end_turn ends with agent.message` + request đầu chứa objective, tool specs và session modelId (LOOP-001) | `src/core/loop/agent-loop.ts`, `HarnessLimits` default |
| T3.3 | `LOOP-003/004: tool call executed, result fed back, then final answer` — test cả response tool-only (`raw` trên tool_use) và text+tool (`raw` trên message); request 2 có tool_result | inspect rồi thực thi tuần tự qua `ToolExecutor` |
| T3.4 | `LOOP-005: tool error returned as isError result and loop continues` | không dừng khi `ok:false` |
| T3.5 | `LOOP-010: malformed response → correction → recovers` — dạng `it.each`: ModelProtocolError, sai schema, rỗng, max_tokens, id trùng, stopReason/shape lệch; response hỏng không có trong log | `harness.malformed_response`, `harness.correction` |
| T3.6 | `LOOP-011: exceeding maxMalformedResponses stops with malformed_response` | đếm theo session (đọc từ log) |
| T3.7 | `LOOP-012: refusal stops with refusal` | |
| T3.8 | `LOOP-007: retryable ModelError retried then succeeds`; `LOOP-008: non-retryable / exhausted → llm_error` | backoff inject được |
| T3.9 | `LIM-001: stops at maxSteps before calling model again` (model luôn gọi tool với input khác nhau; assert số request = maxSteps); `LIM-004: maxToolCalls` | `harness.limit_hit` |
| T3.10 | `LIM-002: deadline aborts hanging model → timeout`; `LOOP-009: per-call model timeout counts as retryable` (model treo tới khi signal abort; limits vài chục ms) | `AbortSignal.any([interrupt, deadline, perCall])` |
| T3.11 | `LIM-003: identical tool call repeated beyond limit → loop_detected, last not executed` | stable stringify (sort keys) |
| T3.12 | `LIM-005: external interrupt → interrupted, running tool aborted` | |
| T3.13 | `LOOP-006: step containing requiresApproval runs no handlers/emits no results early; inspect errors are deferred; resume emits exactly one result/call in original order` | inspect toàn bộ rồi trả pending step cho ordered-step executor |

**Xong M3 khi:** mọi dòng `done`; `agent-loop.ts` không import gì từ `api/`, `cli/`, `core/session/session-manager`.
