# M5 — Observability

**Spec:** `docs/specs/05-observability.md`.

| Task | Seam | Test đỏ (tên) | Code |
|---|---|---|---|
| T5.1 | S4 | `OBS-002: one span.model_request per attempt with own durationMs and tokens` (retry 1 lần → 2 span, attempt 1 có `error`) | emit trong loop |
| T5.2 | S4 | `OBS-003: one span.tool_attempt per attempt with outcome` (lỗi→ok → 2 span `upstream_unavailable`, `ok`) | callback `onAttempt` của executor |
| T5.3 | S5 | `OBS-004: session.status events trace every transition; session.error on failure` | trong `updateStatus` |
| T5.4 | S2 | `OBS-007: summarize(events)` với log mẫu viết tay (kỳ vọng là literal) | `src/core/observability/summary.ts` |
| T5.5 | — | `OBS-001/005: logger writes one JSON line with bindings; child merges; level filter; completed trace contains model/tool/approval/stop events` (sink `write` giả) | triển khai logger nhỏ, độc lập; không sao chép implementation từ sandbase |
| T5.6 | — | `OBS-006: metrics counters/histogram render Prometheus text` | module metrics độc lập, gắn vào loop/executor qua hooks |
