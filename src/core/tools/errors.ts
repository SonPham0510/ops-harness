import type { ToolErrorCode } from "@/types/tool.js";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ToolErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ToolError";
    this.code = code;
    this.retryable = retryable;
  }
}
