# M1 — Nền móng: types, state machine, event log, projection

**Goal:** có lõi dữ liệu mà mọi thứ khác dựa vào — state machine, event log append-only,
projection sang OpenRouter Chat Completions messages.
**Seams:** S1, S2. **Spec:** `docs/specs/01-session-events.md`.

Mỗi task: (1) viết test đỏ → (2) chạy, xác nhận FAIL đúng lý do → (3) code tối thiểu →
(4) chạy, xác nhận PASS + quality gate → (5) đánh `done` trong README + ghi ledger.
Chỉ commit khi người dùng cho phép.

---

### T1.0 Scaffold
**Files:** `package.json`, `tsconfig.json`, `tsconfig.tests.json`, `vitest.config.ts`, `.gitignore`,
`src/index.ts`, `tests/unit/smoke.test.ts`
- deps: `@openrouter/sdk zod hono @hono/node-server commander nanoid`;
  dev: `typescript tsx tsup vitest @types/node`.
- scripts: `test`, `test:watch`, `typecheck` (src + tests), `dev` (`tsx src/cli/main.ts`), `build` (tsup).
- alias `@/` → `src/` trong cả tsconfig và vitest.
- Test smoke: `import { VERSION } from '@/index.js'` là string.
- Verify: `bun run check && bun run typecheck && bun run test` xanh.

### T1.1 transition — SES-001
**Files:** `src/types/session.ts`, `src/core/session/state-machine.ts`, `tests/unit/state-machine.test.ts`
- Test: `transition('queued','running')` → `'running'`; `transition('completed','running')` throw
  `InvalidTransitionError` có `.from === 'completed'`, `.to === 'running'`;
  `canTransition('paused','requires_action')` → false.
- Code: `SESSION_TRANSITIONS` theo bảng spec, `transition`, `canTransition`.

### T1.2 isTerminal — SES-002
- Test: bảng `[status, expected]` cho cả 6 status (giá trị kỳ vọng lấy từ spec, không từ bảng code).
- Code: `isTerminal`.

### T1.3 InMemoryEventLog append — EVT-001
**Files:** `src/types/events.ts`, `src/core/events/event-log.ts`, `tests/unit/event-log.test.ts`
- Test: 2 lần append cùng session → seq 1, 2; session khác bắt đầu lại 1; id khớp `/^sevt_/`; có `createdAt`.
- Test: `session.created` chấp nhận `modelId` không rỗng, từ chối chuỗi rỗng.
- Test: event sai payload bị từ chối bởi `SessionEventSchema`.
- Test `EVT-003`: interface không expose update/delete; events đã append không bị thay đổi khi object
  input ban đầu bị mutate.
- Code: `SessionEvent` discriminated union, `SessionEventSchema`,
  interface `EventLog { append; getEvents; latestSeq }`, `InMemoryEventLog`.

### T1.4 getEvents afterSeq — EVT-002
- Test: append 3 → `getEvents(id)` 3 event theo seq; `getEvents(id, 1)` → seq 2, 3; session lạ → `[]`.

### T1.5 JsonlEventLog — EVT-004
**Files:** `src/core/events/jsonl-event-log.ts`, `tests/unit/jsonl-event-log.test.ts`
- Test (thư mục tmp): append 2 event → file `<dir>/<id>.jsonl` có 2 dòng JSON parse được;
  tạo instance mới trên cùng dir → `getEvents` trả đúng 2 event (so `type`, `seq`, `content`);
  append tiếp → seq 3. `listSessionIds()` trả id; dòng JSON sai schema → `InvalidEventLogError`.
- Code: đọc lười + cache theo session, `appendFileSync` (đơn tiến trình, đủ cho phạm vi này).

### T1.6 eventsToMessages grouping — EVT-005
**Files:** `src/core/session/events-to-messages.ts`, `tests/unit/events-to-messages.test.ts`
- Test: log `user.message("hi")`, `agent.message("checking")`, `agent.tool_use(A)`, `agent.tool_use(B)`,
  `agent.tool_result(A)`, `agent.tool_result(B, isError)` → đúng 4 message:
  `user`, `assistant(content + toolCalls A/B)`, `tool(A)`, `tool(B, JSON error)`.

### T1.7 eventsToMessages raw + correction + skip — EVT-005
- Test 1: response text + tool call đặt `raw` trên `agent.message`; response chỉ có tool call đặt
  `raw` trên `agent.tool_use` đầu tiên; cả hai projection dùng đúng `raw` và không nhân đôi.
- Test 2: `harness.correction` → message user text.
- Test 3: chèn `session.status`, `span.model_request`, `harness.limit_hit`, `user.tool_confirmation` →
  output không đổi.

### T1.8 findOrphanedToolUses — EVT-006
**Files:** `src/core/session/session-recovery.ts`, `tests/unit/session-recovery.test.ts`
- Test: tool_use A, B; result A → `[B]`; không có tool_use → `[]`.

### T1.9 projectSession — EVT-007
**Files:** `src/core/session/project-session.ts`, `tests/unit/project-session.test.ts`
- Test: log `session.created(modelId) → running → requires_action → approval.decided → running →
  completed` dựng đúng objective, model id, status, pending ids chưa quyết định, stop reason và final
  answer; log thiếu `session.created` bị từ chối.

**Xong M1 khi:** 10 task `done` (T1.0–T1.9), quality gate xanh.
