# SPEC 01 — Session, state machine, event log

## State machine (seam S1)

| From | Được phép chuyển sang |
|---|---|
| `queued` | `running`, `completed`, `failed` |
| `running` | `paused`, `requires_action`, `completed`, `failed` |
| `paused` | `running`, `completed`, `failed` |
| `requires_action` | `running`, `completed`, `failed` |
| `completed`, `failed` | — (terminal) |

- **SES-001** `transition(from, to)` trả `to` nếu hợp lệ, ngược lại throw `InvalidTransitionError`
  có `from`, `to`.
- **SES-002** `isTerminal(s)` đúng với và chỉ với `completed`, `failed`.
- **SES-003** Session mới có status `queued`, id dạng `sess_` + 16 ký tự.
- **SES-004** Harness là **one-shot theo objective**: khi loop dừng với `end_turn` session chuyển
  `completed`; khi dừng vì giới hạn/lỗi (`max_steps | timeout | loop_detected |
  malformed_response | llm_error | refusal`) chuyển `failed` và ghi `stopReason`.
- **SES-005** Khi loop dừng vì `tool_confirmation`, session chuyển `requires_action`, lưu
  `pendingToolUseIds`.
- **SES-006** `interrupted` (user stop) → `completed` với `stopReason: 'interrupted'`.
- **SES-007** Các turn của cùng một session chạy tuần tự, không chồng lấn.
- **SES-008** Gửi event vào session terminal → lỗi `SessionTerminalError`.
- **SES-009** `SessionManager.subscribe(sessionId, listener) → unsubscribe` phát mỗi event mới đúng
  một lần, theo `seq`; session lạ → `SessionNotFoundError`. Subscription chỉ là live notification;
  caller phải dùng `events(id, afterSeq)` để backfill trước khi subscribe.

## Event log (seam S2)

Mọi event là một phần tử của discriminated union `SessionEvent`, có envelope chung
`{ id, sessionId, seq, createdAt, type, step? }`. Payload tối thiểu theo `type`:

- `session.created { objective, modelId? }`, `session.status { from, to, stopReason? }`,
  `session.error { code, message }`.
- `user.message { content }`, `user.tool_confirmation { toolUseId, result, denyMessage? }`.
- `agent.message { content, raw? }`, `agent.tool_use { toolUseId, name, input, raw? }`,
  `agent.tool_result { toolUseId, content, isError }`.
- `approval.requested { toolUseId, name, input }`,
  `approval.decided { toolUseId, result, denyMessage? }`.
- `span.model_request`, `span.tool_attempt`, `harness.malformed_response`,
  `harness.correction`, `harness.limit_hit` theo các spec tương ứng.

`raw` xuất hiện đúng một lần cho mỗi model response: trên `agent.message` nếu response có text,
ngược lại trên `agent.tool_use` đầu tiên. Mọi event được validate bằng `SessionEventSchema` trước
khi append và khi đọc lại từ JSONL.

- **EVT-001** `append(sessionId, e)` gán `id` (`sevt_…`), `seq` = seq lớn nhất + 1 (bắt đầu 1),
  `createdAt`; trả về event đầy đủ.
- **EVT-002** `getEvents(sessionId, afterSeq?)` trả theo `seq` tăng dần; `afterSeq` lọc `seq > afterSeq`.
- **EVT-003** Log là append-only: không có API update/delete.
- **EVT-004** `JsonlEventLog` ghi mỗi event một dòng JSON vào `<dir>/<sessionId>.jsonl`;
  mở lại cùng thư mục thì đọc lại được đúng các event và `seq` tiếp tục tăng;
  `listSessionIds()` trả các session id đã lưu.
- **EVT-005** `eventsToMessages(events)` dựng `ChatMessages[]` theo public types của
  `@openrouter/sdk` (SDK tự serialize camelCase sang OpenRouter wire format):
  - `user.message` → `{ role: 'user', content }`.
  - `agent.message` + `agent.tool_use` liên tiếp của cùng một step → **một** message `assistant`
    có `content` và `toolCalls`; mỗi call có `{ id, type: 'function', function: { name,
    arguments } }`, trong đó `arguments` là JSON string.
  - nếu group assistant có event mang `raw` (assistant message gốc) thì dùng nguyên `raw`, không
    dựng lại hay nhân đôi tool call.
  - mỗi `agent.tool_result` → một message `{ role: 'tool', toolCallId, content }`; thành công giữ
    nguyên `content`, lỗi encode thành JSON string `{ "error": true, "message": content }`, không
    giả làm kết quả thành công.
  - `harness.correction` → message `user` text (lời nhắc sửa response hỏng).
  - bỏ qua `session.*`, `span.*`, `harness.limit_hit`, `user.tool_confirmation`.
- **EVT-006** `findOrphanedToolUses(events)` trả các `tool_use` chưa có `tool_result` tương ứng.
- **EVT-007** `projectSession(events)` dựng `SessionSnapshot` từ `session.created`,
  `session.status`, approval và agent events; trả `{ id, objective, status, stopReason?,
  modelId?, pendingToolUseIds, finalAnswer? }`. `pendingToolUseIds` chỉ gồm request chưa có
  `approval.decided` hay `agent.tool_result`. `SessionManager.get()` không giữ một bản state có thể
  lệch khỏi log mà luôn dùng projector này.
