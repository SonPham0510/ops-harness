# M4 — SessionManager & luồng duyệt

**Goal:** control plane kiểu sandbase: create → sendEvent → turn tuần tự → status theo state
machine; duyệt bằng suspend/resume. **Seam:** S5. **Spec:** SPEC 01 (SES-*), SPEC 04 (APR-*).

Helper test: `setup({ steps, faults?, policy? }) → { manager, incidents, waitFor(status) }`.
`waitFor` poll `manager.get(id).status` (timeout 1s) — không `sleep` cố định.

| Task | Test đỏ (tên) | Code |
|---|---|---|
| T4.1 | `SES-003/EVT-007: create returns queued projected session with sess_ id and persisted modelId` | `src/core/session/session-manager.ts`; append event rồi dùng `projectSession` |
| T4.2 | `SES-004: objective runs to completed with final answer` | `start(objective)` = create + `user.message`; `executor.ts` nối loop |
| T4.3 | `SES-004: loop limit stop → failed with stopReason and session.error` | map stopReason → status |
| T4.4 | `SES-007: turns serialized`; `SES-008: event to terminal session rejected` | execution chain / session |
| T4.5 | `APR-001/003: create_incident suspends session in requires_action; incident not created` | pending ids trong session |
| T4.6 | `APR-002: invalid create_incident input gets no approval request; when paired with pending approval its result is deferred for ordering` | validate trước khi xin duyệt |
| T4.7 | `APR-004/LIM-002: allow records decision, approval wait does not consume run deadline, ordered pending step completes` | `core/approval/confirmation.ts` |
| T4.8 | `APR-005: deny returns isError result, tool not run, model informed` | |
| T4.9 | `APR-006: confirmation for unknown/handled id throws, no side effects` | |
| T4.10 | `APR-007: two pending calls decided out of order — no handler runs early; results emit in original call order after both decisions` | |
| T4.11 | `APR-008: auto_allow / auto_deny use ordered-step executor, policy approver events and running→requires_action→running transitions` | |
| T4.12 | `SES-006: interrupt during run → completed/interrupted` | abort controller / turn |
| T4.13 | `APR-009/EVT-007: restart rebuilds snapshot/modelId, records running→paused→running around orphan reconciliation; requires_action and partial decisions survive` | `manager.recover()` |
| T4.14 | `OPS-004 e2e: allowed create_incident with errorAfterCommit fault creates exactly one incident` | — (kiểm chứng tích hợp) |
| T4.15 | `SES-009: subscribe receives each new event once in seq order; unsubscribe stops delivery; unknown session throws` | listener registry nội bộ SessionManager |
