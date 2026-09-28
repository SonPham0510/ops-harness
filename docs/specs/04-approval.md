# SPEC 04 — Duyệt trước khi chạy (human-in-the-loop)

Mô hình **suspend/resume qua event** (học từ sandbase-harness `tool-resolver.handleToolConfirmation`),
không giữ promise treo trong loop. Seam S5 (`SessionManager`).

- **APR-001** Tool `requiresApproval` (hiện là `create_incident`) chỉ được chạy sau khi có
  `user.tool_confirmation { toolUseId, result: 'allow' }`.
- **APR-002** Input được validate **trước** khi xin duyệt. Input sai → `agent.tool_result`
  `invalid_input`, **không** xin duyệt; nếu cùng step có call hợp lệ cần duyệt thì result lỗi được
  defer để giữ ordering theo LOOP-006.
- **APR-003** Khi xin duyệt: emit `approval.requested { toolUseId, name, input }` cho từng call hợp
  lệ cần duyệt, session sang `requires_action`, `session.pendingToolUseIds` chứa các id chưa quyết định.
- **APR-004** Sau khi append `user.tool_confirmation`, hệ thống emit đúng một `approval.decided`;
  session vẫn `requires_action` cho tới khi mọi pending id đã có quyết định. Khi đó session sang
  `running`, **mọi** call của step được xử lý theo thứ tự model trả: inspect-error emit kết quả lỗi,
  call thường và call `allow` chạy qua `ToolExecutor`, call `deny` tạo kết quả lỗi nhưng không chạy
  handler. Sau khi mọi call có đúng một result, loop tiếp tục.
- **APR-005** `deny` (kèm `denyMessage` tuỳ chọn) → `agent.tool_result` `isError: true`,
  nội dung `"User denied create_incident: <lý do>. Do not retry; report to the user instead."`,
  tool **không** chạy, loop tiếp tục để model trả lời người dùng.
- **APR-006** Confirmation cho id không đang chờ (sai id, đã xử lý) → lỗi `InvalidConfirmationError`,
  không có tác dụng phụ.
- **APR-007** Nhiều call chờ duyệt trong cùng step có thể được quyết định theo bất kỳ thứ tự nào,
  nhưng mỗi id chỉ được quyết định một lần và không handler nào chạy trước khi **tất cả** id có
  quyết định. Kết quả tool sau đó vẫn được emit theo thứ tự call ban đầu.
- **APR-008** Chế độ tự động cấu hình được: `approvalPolicy: 'manual' | 'auto_deny' | 'auto_allow'`
  (mặc định `manual`). `auto_*` cung cấp ngay quyết định cho mọi pending call nhưng vẫn đi qua cùng
  ordered-step executor; emit đủ `approval.requested` + `approval.decided` với
  `approver: 'policy'`, gồm cả transition ngắn `running → requires_action → running` để trace và
  projector dùng cùng một state path như manual approval.
- **APR-009** Crash recovery: khi khởi động lại từ `JsonlEventLog`, session `running` có tool_use
  mồ côi → append transition `running → paused`, chèn `agent.tool_result` lỗi
  `"interrupted by restart"`, chuyển `paused → running` và schedule loop tiếp tục; session
  `requires_action` giữ nguyên pending step/các decision đã có và vẫn duyệt được. Model id override
  được phục hồi từ `session.created`. Snapshot sau recovery luôn dựng lại bằng `projectSession`.
