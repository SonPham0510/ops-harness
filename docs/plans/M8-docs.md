# M8 — Docs & kiểm chứng cuối

| Task | Nội dung | Xong khi |
|---|---|---|
| T8.1 | `README.md`: quickstart (demo offline + OpenRouter), CLI và API examples, sơ đồ kiến trúc, vòng đời session, bảng "học từ sandbase-harness / cải tiến gì", trade-offs (tool tuần tự, JSONL thay DB, one-shot session, duyệt bằng suspend/resume), cách đọc trace | người lạ chạy được demo trong < 2 phút |
| T8.2 | `scripts/check-spec-coverage.mjs`: gom từng ID đầy đủ trong `docs/specs` (không dùng dạng rút gọn `CLI-003/004`), tìm đúng ID trong tên test, in ID chưa có test; thêm vào `bun run verify` | mọi ID đều có test, script exit 0 |
