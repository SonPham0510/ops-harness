# M6 — Model adapters

**Spec:** `docs/specs/06-models.md`. Test S6 dùng object `{ chat: { send: vi.fn() } }` theo
public interface của `@openrouter/sdk` — biên ngoài, được phép giả. Không gọi API thật; tạo lỗi bằng
class/status có kiểu của SDK hoặc fake tối thiểu khớp public error contract.

| Task | Test đỏ (tên) | Code |
|---|---|---|
| T6.1 | `MDL-001/004: sends chatRequest with system, function tools/messages plus signal and retries:none; request→constructor→env→default precedence accepts arbitrary ids` | `src/model/openrouter.ts` |
| T6.2 | `MDL-002: preserves raw assistant message; maps string/part content, toolCalls, refusal/finish reasons and usage; malformed arguments/empty choices throw ModelProtocolError` | bảng case literal |
| T6.3 | `MDL-003: SDK abort/connection, response validation and typed HTTP errors map to abort/protocol/retryable correctly` | class + numeric status/code, không so message |
| T6.4 | `MDL-006: DemoModel + SessionManager: degraded service → status, KB, create_incident (approved) → final answer mentions incident id`; `operational → no incident` | `src/model/demo.ts` |
