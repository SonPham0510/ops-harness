# SPEC 06 — Model adapters

## OpenRouterModel (seam S6, SDK client giả trong test)

`OpenRouterModel` dùng SDK chính thức `@openrouter/sdk`, khởi tạo với API key từ
`OPENROUTER_API_KEY`, và gọi OpenRouter Chat Completions qua `client.chat.send`. SDK chỉ là lớp
transport; harness tự quản lý agent loop, tool execution, retry, approval và state.

- **MDL-001** Gọi `client.chat.send({ chatRequest: { model, messages, tools,
  maxCompletionTokens: 16000, stream: false } }, { signal })`. System instruction là message
  `role: 'system'` đầu tiên. Tool dùng OpenRouter function-tool schema. Không ép gọi tool; bỏ
  `toolChoice` để OpenRouter dùng auto. Assistant message gốc từ response được giữ nguyên để
  projection gửi lại y nguyên ở request kế tiếp. Request options đặt `retries: { strategy: 'none' }`
  để retry chỉ xảy ra trong AgentLoop và mỗi attempt đều observable.
- **MDL-002** Map `response.choices[0].message`: `text` là content string hoặc nối các content part
  `{ type: 'text', text }`; `toolCalls` lấy từ `message.toolCalls`, parse `function.arguments` như
  JSON object; `stopReason` ưu tiên non-empty `message.refusal`/`content_filter → refusal`, sau đó
  map `stop → end_turn`, `tool_calls → tool_use`, `length → max_tokens`, còn lại `other`; `raw` là
  nguyên assistant message; usage lấy từ `promptTokens`/`completionTokens`.
  Thiếu choice/message, tool arguments không phải JSON object, hoặc response không qua schema →
  `ModelProtocolError` để AgentLoop xử lý theo `LOOP-010`.
- **MDL-003** Map lỗi bằng **class + `statusCode` có kiểu** của SDK, không so chuỗi message.
  `RequestAbortedError` do caller abort được throw lại nguyên. `ConnectionError`,
  `RequestTimeoutError`, `RequestTimeoutResponseError`, `TooManyRequestsResponseError`,
  `InternalServerResponseError`, `BadGatewayResponseError`, `ServiceUnavailableResponseError`,
  `EdgeNetworkTimeoutResponseError`, `ProviderOverloadedResponseError` và HTTP
  `408 | 429 | 500..599 | 524 | 529` → `ModelError { retryable: true }`; các typed request/auth/quota
  errors `400 | 401 | 402 | 403 | 404 | 413 | 422`, outbound `SDKValidationError` và lỗi không nhận
  diện → `retryable: false`. SDK `ResponseValidationError` → `ModelProtocolError` kèm raw response.
- **MDL-004** Model id chấp nhận mọi string không rỗng mà OpenRouter hỗ trợ. `OpenRouterModel`
  chọn theo thứ tự: `complete(req).modelId` → model id lúc construct → `OPENROUTER_MODEL` →
  `deepseek/deepseek-v4.1-flash`. Giá trị session đã chọn phải ổn định qua mọi step và recovery.

## ScriptedModel (dùng cho test)

- **MDL-005** Nhận danh sách bước; mỗi bước là object trả thẳng (có thể cố tình sai schema),
  hàm `(req) => unknown | Promise<unknown>`, hoặc `{ throw: ModelError }`. Hết bước → throw
  lỗi rõ ràng. Ghi lại mọi request để test kiểm tra.

## DemoModel (chạy offline)

- **MDL-006** Rule-based trên objective + tool result đã có:
  1. tìm tên service trong objective (so với danh sách service mock) → `get_service_status`;
  2. → `search_knowledge_base` với tên service + từ khoá;
  3. nếu status ≠ `operational` và chưa tạo incident → `create_incident` (severity: outage→high,
     degraded→medium);
  4. → câu trả lời tổng hợp (status, runbook tìm được, incident id hoặc lý do bị từ chối).
