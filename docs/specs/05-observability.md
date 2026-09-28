# SPEC 05 — Observability

- **OBS-001** Mỗi session có trace = event log của nó (JSONL khi dùng `JsonlEventLog`).
  Đọc lại trace đủ để biết: objective, mỗi lần gọi model, mỗi tool call + từng lần thử,
  mọi quyết định duyệt, lý do dừng.
- **OBS-002** `span.model_request { step, attempt, durationMs, inputTokens, outputTokens,
  stopReason | error }` cho **mỗi** lần gọi model; `durationMs` là của riêng lần gọi đó.
- **OBS-003** `span.tool_attempt { toolUseId, name, attempt, durationMs, outcome: 'ok'|errorCode }`
  cho **mỗi** lần thử tool.
- **OBS-004** `session.status { from, to, stopReason? }` mỗi lần đổi trạng thái;
  `session.error { code, message }` khi dừng vì lỗi.
- **OBS-005** Logger JSON một dòng/record ra stderr, có `child({ sessionId })`; mức log qua
  `OPS_AGENT_LOG_LEVEL`, dạng dễ đọc qua `OPS_AGENT_LOG_FORMAT=pretty`.
- **OBS-006** Metrics trong process: counter `ops_model_requests_total`,
  `ops_tool_calls_total{tool,outcome}`, `ops_sessions_total{stop_reason}`, histogram
  `ops_tool_duration_ms`; `GET /metrics` dạng Prometheus.
- **OBS-007** Tóm tắt khi kết thúc: `summarize(events)` trả `{ status, stopReason, steps,
  toolCalls, errors, approvals, tokens, durationMs }` — dùng cho CLI `show` và `GET /sessions/:id`.
