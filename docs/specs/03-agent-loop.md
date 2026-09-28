# SPEC 03 — Agent loop & limits

Seam S4: `new AgentLoop(deps).execute(ctx): AsyncIterable<SessionEvent>` — tự viết, thay cho
`streamText`. Kết quả cuối lấy qua `ctx.onStop(stopReason, detail)`.

## Model contract

`ModelClient.complete({ system, messages, tools, modelId?, signal }) → Promise<unknown>`.
`modelId` là override của session và được truyền nguyên tới adapter. Harness validate bằng
`ModelResponseSchema`:

```ts
{ text: string, toolCalls: { id: string(min1), name: string(min1), input: Record<string, unknown> }[],
  stopReason: 'end_turn'|'tool_use'|'max_tokens'|'refusal'|'other', raw?: unknown,
  usage?: { inputTokens: number, outputTokens: number } }
```

Lỗi transport/provider: adapter throw `ModelError { retryable }`. Lỗi response không đúng protocol
(kể cả `ResponseValidationError` từ SDK) → throw `ModelProtocolError { detail, raw? }`.

## Vòng lặp

- **LOOP-001** Mỗi step: gọi model với messages dựng từ event log (`eventsToMessages`),
  `registry.specs()` và `modelId` của session.
- **LOOP-002** Response `stopReason: 'end_turn'`, không có tool call và có text → emit
  `agent.message`, dừng `end_turn`.
- **LOOP-003** Response có tool call → emit `agent.message` (nếu có text) và một `agent.tool_use`
  cho mỗi call (kèm `raw` ở event đầu tiên của step), rồi thực thi.
- **LOOP-004** Loop gọi `ToolExecutor.inspect` cho mọi tool call trước. Nếu không call nào cần
  duyệt, các call được thực thi **tuần tự** theo thứ tự model trả; mỗi call sinh đúng một
  `agent.tool_result` (kể cả lỗi), với `isError` tương ứng.
- **LOOP-005** Lỗi tool **không** dừng loop — kết quả lỗi được đưa lại cho model ở step sau.
- **LOOP-006** Nếu step có ít nhất một call hợp lệ `requiresApproval`, không handler và không
  `agent.tool_result` nào của step được chạy/emitted trước khi đủ quyết định. Kết quả inspect lỗi
  được giữ cùng pending step nhưng không tạo approval request. Loop dừng `tool_confirmation` với
  danh sách id hợp lệ cần duyệt (xem SPEC 04). Sau khi đủ quyết định, ordered-step executor đi qua
  **mọi** call theo thứ tự ban đầu: emit lỗi inspect, chạy call thường/được duyệt, hoặc emit lỗi deny.

## Lỗi model

- **LOOP-007** `ModelError` retryable (429/5xx/mạng/timeout) → thử lại tối đa `modelMaxRetries`
  (mặc định 2) với backoff; mỗi lần thử emit `span.model_request` có `attempt`, `error`.
- **LOOP-008** `ModelError` không retryable hoặc hết lượt retry → dừng `llm_error`.
- **LOOP-009** Mỗi lần gọi model có timeout riêng `modelTimeoutMs` (mặc định 60000), cộng với deadline chung.

## Response hỏng

- **LOOP-010** `ModelProtocolError`, response không qua `ModelResponseSchema`, text rỗng + không tool call,
  `stopReason: 'max_tokens'` (có hay không tool call), id tool call trùng nhau, hoặc stop reason
  không khớp shape (`tool_use` nhưng không có call; có call nhưng không phải `tool_use`) →
  **malformed**: emit `harness.malformed_response` (lý do) + `harness.correction` (lời nhắc),
  **không** ghi response vào log, sang step sau. `refusal` được xử lý riêng bởi LOOP-012.
- **LOOP-011** Quá `maxMalformedResponses` (mặc định 2) lần malformed trong một session → dừng
  `malformed_response`.
- **LOOP-012** `stopReason: 'refusal'` → dừng `refusal`.

## Giới hạn

- **LIM-001** Số step (lần gọi model) trong session > `maxSteps` (mặc định 10) → emit
  `harness.limit_hit {limit:'max_steps'}`, dừng `max_steps`, **trước** khi gọi model thêm.
- **LIM-002** Deadline chung `maxRunMs` (mặc định 120000) tính từ lúc session bắt đầu chạy;
  vượt → abort model/tool đang chạy, dừng `timeout`. Thời gian ở `requires_action` **không** tính.
- **LIM-003** Loop-guard: cùng `name` + cùng input (JSON có khoá đã sắp xếp) được đề xuất quá
  `maxIdenticalToolCalls` (mặc định 3) lần → dừng `loop_detected`, không thực thi lần đó.
- **LIM-004** Tổng tool call > `maxToolCalls` (mặc định 30) → dừng `max_steps`.
- **LIM-005** Interrupt từ ngoài (AbortSignal) → dừng `interrupted`; tool/model đang chạy bị abort.
