# SPEC 02 — Tools: registry, validation, execution

Seam S3:

- `ToolExecutor.inspect(call) → ToolInspection`: resolve tool + validate input nhưng không gọi handler.
- `ToolExecutor.run(call, ctx) → Promise<ToolOutcome>`: thực thi đầy đủ, dùng cùng logic inspect.

```ts
type ToolOutcome =
  | { ok: true;  output: unknown; content: string; attempts: number }
  | { ok: false; error: { code: ToolErrorCode; message: string; retryable: boolean }; content: string; attempts: number }

type ToolErrorCode = 'unknown_tool' | 'invalid_input' | 'invalid_output' | 'timeout'
                   | 'upstream_unavailable' | 'not_found' | 'execution_error' | 'aborted'
```

`run` **không bao giờ throw** với lỗi của tool; mọi lỗi được trả về dưới dạng `ok: false`.
`inspect` trả `{ ok: true, requiresApproval }` hoặc cùng outcome lỗi `unknown_tool | invalid_input`;
handler không bao giờ được gọi bởi `inspect`.

## Định nghĩa tool

Mỗi tool có: `name`, `description`, `input` (zod), `output` (zod), `handler(input, ctx)`,
`timeoutMs` (mặc định 5000), `maxRetries` (mặc định 2), `idempotent` (mặc định true),
`requiresApproval` (mặc định false). `registry.specs()` trả OpenRouter function-tool schema
`{ type: 'function', function: { name, description, parameters } }`, với `parameters` là JSON
Schema sinh từ zod.

## Hành vi

- **TOOL-001** Tên tool không có trong registry → `unknown_tool`, không retry; `content` liệt kê
  các tool hợp lệ.
- **TOOL-002** Input không qua schema → `invalid_input`, không retry, handler **không** được gọi;
  `content` có đường dẫn trường lỗi (vd `severity: Invalid enum value`). `inspect` và `run` phải
  cho cùng kết quả validation.
- **TOOL-003** Output không qua schema → `invalid_output`, không retry; output hỏng **không** được
  đưa vào `content`.
- **TOOL-004** Lỗi `retryable` được thử lại tối đa `maxRetries` lần với backoff mũ
  (`baseDelayMs * 2^(attempt-1)`, jitter ≤ 20%); `attempts` phản ánh số lần đã chạy.
- **TOOL-005** Handler chạy quá `timeoutMs` → bị abort (`ctx.signal` aborted) và tính là lỗi
  `timeout` (retryable).
- **TOOL-006** Lỗi không retryable (`not_found`, `invalid_*`) chỉ chạy 1 lần.
- **TOOL-007** Tool `idempotent: false` không bao giờ được retry.
- **TOOL-008** Mỗi lần gọi nhận `ctx.idempotencyKey = ${sessionId}:${toolUseId}` giống nhau qua
  mọi lần retry.
- **TOOL-009** `content` thành công = JSON của output, cắt ở `maxResultChars` (mặc định 8000) kèm
  hậu tố `[truncated N chars]`.
- **TOOL-010** Signal của run bị abort (deadline/interrupt) → dừng ngay, lỗi `aborted`, không retry.
- **TOOL-011** Handler throw `Error` thường (không phải `ToolError`) → `execution_error`, retryable.

## Mock ops tools

- **OPS-001** `search_knowledge_base({ query: string 1..500 })` →
  `{ results: [{ id, title, snippet, score }] }`, xếp theo score giảm dần, tối đa 5.
- **OPS-002** `get_service_status({ service_name: /^[a-z0-9-]{1,64}$/ })` →
  `{ service, status: 'operational'|'degraded'|'outage', errorRate, latencyP95Ms, checkedAt }`;
  service lạ → `not_found`.
- **OPS-003** `create_incident({ title 5..120, description 10..4000,
  severity: 'low'|'medium'|'high'|'critical' })` → `{ incidentId, url, severity, createdAt,
  deduplicated }`; `requiresApproval: true`; `idempotent: true` nhờ idempotency key.
- **OPS-004** Incident store chống trùng: cùng `idempotencyKey` → trả incident cũ với
  `deduplicated: true`, không tạo bản mới.
- **OPS-005** Fault injection: backend nhận hàng đợi lỗi cho từng tool
  (`error{retryable}`, `delay{ms}`, `badOutput`, `errorAfterCommit`) để test và chạy `--chaos`.
