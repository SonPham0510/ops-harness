# SPEC 00 — Tổng quan

## Đề bài gốc

> For this assessment, you are required to build an Agent Harness for an operations assistant. The
> goal is to evaluate your ability to design and manage agent execution, tool calling, state,
> failures, and safety controls.
>
> The agent may use the following mock tools:
>
> - `search_knowledge_base(query)`: Search internal documentation
> - `get_service_status(service_name)`: Retrieve the current status of service
> - `create_incident(title, description, severity)`: Create an incident in an external system
>
> Evaluation Criteria:
>
> - Agent-loop and state-management design
> - Tool integration and validation
> - Error handling and safety controls
> - Code quality, observability, and testing
>
> Your Task — build an Agent Harness that:
>
> - Accepts a user objective through an API or CLI.
> - Supports an LLM–tool execution loop.
> - Validates tool inputs and outputs.
> - Maintains agent state and execution history.
> - Handles tool errors, timeouts, retries, and malformed LLM responses.
> - Prevents infinite loops using step or time limits.
> - Requires user approval before calling `create_incident`.
> - Produces logs or traces for each execution.
> - Includes tests for important success and failure cases.

## Mục tiêu

Một agent harness nhận **objective** qua CLI hoặc HTTP API, điều phối vòng lặp LLM ↔ tool cho một
operations assistant, và luôn kết thúc ở một trạng thái xác định, có giải thích, có trace.

## Quyết định kiến trúc

Không dùng agent framework (LangChain, AI SDK `streamText`, OpenRouter Agent SDK). Harness chỉ dùng
SDK model làm transport; agent loop, state machine, tool execution, retry, approval, limits và trace
được tự viết vì đây là phần chính của assessment.

Implementation cung cấp cả CLI lẫn HTTP API trên cùng lõi harness. Đây là phần showcase bổ sung;
acceptance criteria gốc chỉ bắt buộc một trong hai interface.

## Mapping yêu cầu đề bài → spec

| Yêu cầu | Spec |
|---|---|
| Nhận objective qua API hoặc CLI | API-001..007, CLI-001..005 |
| Vòng lặp LLM–tool | LOOP-001..006 |
| Validate input/output tool | TOOL-001..003 |
| Lưu state + lịch sử thực thi | SES-001..009, EVT-001..007 |
| Lỗi tool, timeout, retry, response LLM hỏng | TOOL-004..011, LOOP-007..012 |
| Chống vòng lặp vô hạn (step/time) | LIM-001..005 |
| Duyệt trước `create_incident` | APR-001..009 |
| Log/trace mỗi lần chạy | OBS-001..007 |
| Test success + failure | mọi ID ở trên đều có ít nhất 1 test |

## Thuật ngữ

- **Session**: một lần chạy cho một objective. Có id `sess_…`, status, event log.
- **Turn**: một lượt engine chạy, bắt đầu bởi một user event (`user.message` hoặc
  `user.tool_confirmation`), kết thúc ở `paused`, `requires_action` hoặc trạng thái terminal.
- **Step**: một lần gọi model trong turn.
- **Event**: bản ghi append-only có `seq` tăng dần trong session.
- **Tool call**: một phần tử `assistant.tool_calls` theo OpenRouter Chat Completions do model đề
  xuất; có opaque id không rỗng do provider cấp.
- **Stop reason**: lý do session/turn dừng — `end_turn | max_steps | timeout | loop_detected |
  malformed_response | llm_error | refusal | tool_confirmation | interrupted`.

## Ngoài phạm vi

Sandbox, auth, DB, UI, đa provider, multi-agent, compaction.
