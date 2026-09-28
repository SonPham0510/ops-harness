# SPEC 07 — HTTP API & CLI

## HTTP (Hono, seam S7 qua `app.request()`)

- **API-001** `POST /sessions { objective: string 1..4000, modelId?: string 1..200,
  limits?: Partial<HarnessLimits>, approvalPolicy?: 'manual'|'auto_deny'|'auto_allow' }` →
  `201 { id, status: 'queued' }`; mọi limit phải là integer dương trong range cấu hình; `modelId`
  chấp nhận mọi OpenRouter model id không rỗng, được persist trong `session.created`, và override
  env/default cho mọi step; schedule chạy bất đồng bộ sau khi response được tạo. Body sai → `400`
  với lỗi zod.
- **API-002** `GET /sessions/:id` → `{ session, summary }` (OBS-007); không có → `404`.
- **API-003** `GET /sessions/:id/events?after_seq=N` → JSON các event `seq > N`.
- **API-004** `GET /sessions/:id/events/stream` → SSE; resume bằng `Last-Event-ID` (= seq):
  backfill `seq > lastSeq`, rồi live, không trùng không sót; đóng stream khi session terminal.
  SessionManager cung cấp subscription interface; HTTP adapter không poll EventLog.
- **API-005** `POST /sessions/:id/approvals { tool_use_id, result: 'allow'|'deny', deny_message? }`
  → `202`; id không chờ duyệt → `409`; session không có → `404`.
- **API-006** `POST /sessions/:id/interrupt` → `202`, dừng `interrupted`.
- **API-007** `GET /healthz` → `200 {ok:true}`; `GET /metrics` → text Prometheus.

## CLI (commander, seam S8 qua `runCli(argv, io)`)

`io` chứa stdin/TTY/prompt/stdout/stderr để test không phụ thuộc process thật.

- **CLI-001** `run <objective> [--model demo|openrouter] [--model-id id] [--approve prompt|allow|deny]
  [--max-steps n] [--timeout-ms n] [--chaos] [--data-dir dir]` chạy tới khi terminal, in tiến trình
  ra stderr, in câu trả lời cuối ra stdout; exit code `0` nếu `completed`, `2` nếu `failed`.
  `--model` mặc định `openrouter`; `--model-id` chỉ hợp lệ với `--model openrouter` và được persist
  cùng session.
- **CLI-002** `--approve prompt` (mặc định khi có TTY): khi `requires_action`, hiện tool + input đã
  validate, hỏi `Approve create_incident? [y/N]`; ngoài `y|yes` đều là từ chối. Không có TTY và
  không truyền `--approve` → mặc định `deny` (an toàn).
- **CLI-003** `show <sessionId>` in summary (OBS-007) từ data dir.
- **CLI-004** `trace <sessionId> [--json]` in event log dạng timeline (hoặc JSONL thô).
- **CLI-005** `serve [--port 8787] [--host 127.0.0.1]` chạy HTTP API.
