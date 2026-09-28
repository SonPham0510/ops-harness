# M7 — HTTP API & CLI

**Spec:** `docs/specs/07-interfaces.md`. Composition root: `src/app.ts`
`createApp({ dataDir?, model, limits, policy }) → { manager, http, metrics }` — CLI và HTTP adapter
đều dùng cùng SessionManager. SessionManager expose subscription interface cho SSE.

| Task | Seam | Test đỏ (tên) | Code |
|---|---|---|---|
| T7.1 | S7 | `API-001: POST /sessions 201 + persists/forwards arbitrary modelId through every step`; invalid body/modelId 400; `API-002`: GET 200 with summary / 404; `API-007`: healthz, metrics | `src/api/server.ts` |
| T7.2 | S7 | `API-003: events after_seq` | |
| T7.3 | S7 | `API-005: approve → 202 → completed; unknown id 409; unknown session 404`; `API-006: interrupt` | |
| T7.4 | S7 | `API-004: SSE backfills after Last-Event-ID, subscribes without a race gap, then receives live events, closes at terminal, no duplicates` | backfill → subscribe → second backfill/dedupe để khép race window |
| T7.5 | S8 | `CLI-001: run --model demo prints answer, exit 0; openrouter forwards --model-id; --model demo + --model-id is usage error; failed run exit 2` | `src/cli/program.ts`, `runCli(argv, io)`; `src/cli/main.ts` gọi với process IO |
| T7.6 | S8 | `CLI-002: prompt y → incident created; prompt n → denied; non-TTY default deny` | `io.prompt` inject được |
| T7.7 | S8 | `CLI-003: show reads summary`; `CLI-004: trace renders timeline/JSONL`; `CLI-005: serve binds port 0 and serves healthz` | |
