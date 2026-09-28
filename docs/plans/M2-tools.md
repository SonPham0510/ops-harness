# M2 — Tools: registry, executor, mock ops tools

**Goal:** `ToolExecutor.inspect()` validate không side effect; `run()` không bao giờ throw với lỗi
tool; mọi lỗi có code + retryable; timeout/retry/validate đúng spec. **Seam:** S3.
**Spec:** `docs/specs/02-tools.md`.

Test dùng tool giả định nghĩa ngay trong test (`defineTool({...})`) và `baseDelayMs: 1` để không chậm.
Kiểm tra backoff bằng cách inject `sleep` (ghi lại delay), không dùng timer thật.

| Task | Files | Test đỏ (tên) | Code tối thiểu |
|---|---|---|---|
| T2.1 | `src/types/tool.ts`, `src/core/tools/{registry,errors}.ts` | `registry.specs()` trả `{type:'function', function:{name, description, parameters}}` với `parameters.type === 'object'` và `required` đúng | `defineTool`, `ToolRegistry`, `ToolError`, zod → JSON Schema (`z.toJSONSchema`, bỏ `$schema`) |
| T2.2 | `src/core/tools/executor.ts`, `tests/unit/tool-executor.test.ts` | `TOOL-001: inspect/run unknown tool return same unknown_tool listing valid tools` | tra registry dùng chung |
| T2.3 | ″ | `TOOL-002: inspect/run invalid input return same invalid_input, handler not called` (spy đếm lần gọi = 0; content chứa tên trường) | một hàm prepare nội bộ dùng `safeParse` + format issues |
| T2.4 | ″ | `TOOL-009: success returns JSON content, truncated beyond maxResultChars` | chạy handler, stringify, cắt |
| T2.5 | ″ | `TOOL-003: output failing schema → invalid_output, bad data not leaked` | validate output |
| T2.6 | ″ | `TOOL-004: retryable error retried with exponential backoff` (fail 2 lần rồi ok → attempts 3, delays ≈ [b, 2b]); `TOOL-011: plain Error → execution_error retryable` | vòng retry + backoff + jitter |
| T2.7 | ″ | `TOOL-006: not_found not retried`; `TOOL-007: idempotent:false never retried` | điều kiện retry |
| T2.8 | ″ | `TOOL-005: handler exceeding timeoutMs is aborted and reported as timeout` (handler chờ signal; assert `signal.aborted`) | `AbortSignal.any` + timer |
| T2.9 | ″ | `TOOL-010: run signal abort stops immediately with aborted, no retry` | kiểm tra parent signal |
| T2.10 | ″ | `TOOL-008: idempotencyKey identical across retries` | tạo key một lần |
| T2.11 | `src/tools/ops/{knowledge-base,service-status}.ts`, `tests/unit/ops-tools.test.ts` | `OPS-001` (query "checkout latency" → runbook checkout đứng đầu, ≤5 kết quả); `OPS-002` (service hợp lệ; tên lạ → not_found; tên sai regex → invalid_input) | dữ liệu mock + scoring token overlap |
| T2.12 | `src/tools/ops/incidents.ts` | `OPS-003` (tạo incident, `requiresApproval` true); `OPS-004` (cùng key → `deduplicated: true`, store size 1) | `IncidentStore` |
| T2.13 | `src/tools/ops/faults.ts` | `OPS-005` (queue `[error retryable, ok]` → attempts 2; `errorAfterCommit` + retry → 1 incident, lần 2 `deduplicated`) | `FaultPlan` + `createOpsTools(backends)` |

**Xong M2 khi:** mọi dòng `done`, test xanh, không có `setTimeout` thật > 50ms trong test.
