# Prompt khởi động cho Codex

Dán nguyên đoạn dưới vào Codex (mở trong `~/ops-agent-harness`):

```
Dùng superpowers:executing-plans để thực thi plan của project này.

- Đọc AGENTS.md trước, rồi docs/specs/00-overview.md, rồi docs/plans/README.md.
- Spec là nguồn sự thật (docs/specs/*.md). Plan nằm ở docs/plans/M1..M8.
- Bắt đầu từ task `todo` đầu tiên có dependency đã `done` (hiện là T1.1), làm lần lượt tới hết M8.
- Mỗi task: superpowers:test-driven-development (tên test có ID spec, thấy đỏ đúng lý do rồi mới code),
  rồi superpowers:verification-before-completion (`bun run check && bun run typecheck && bun run test`).
- Cập nhật trạng thái trong docs/plans/README.md và ghi docs/plans/LEDGER.md sau mỗi task.
- Chỉ test ở seam S1–S8 trong AGENTS.md. Không gọi OpenRouter API thật trong test.
- Không commit, không cài thêm dependency ngoài danh sách trong AGENTS.md.
- Hết mỗi milestone: superpowers:requesting-code-review cho phần vừa làm, sửa các lỗi được xác nhận.
```
