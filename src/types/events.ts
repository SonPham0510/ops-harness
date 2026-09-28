import { z } from "zod";

const SessionStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "requires_action",
  "completed",
  "failed",
]);

const StopReasonSchema = z.enum([
  "end_turn",
  "max_steps",
  "timeout",
  "loop_detected",
  "malformed_response",
  "llm_error",
  "refusal",
  "tool_confirmation",
  "interrupted",
]);

const ModelStopReasonSchema = z.enum([
  "end_turn",
  "tool_use",
  "max_tokens",
  "refusal",
  "other",
]);

const inputMetadataShape = {
  step: z.number().int().positive().optional(),
};

const eventEnvelopeShape = {
  createdAt: z.iso.datetime(),
  id: z.string().startsWith("sevt_"),
  seq: z.number().int().positive(),
  sessionId: z.string().min(1),
};

const SessionCreatedInputSchema = z
  .object({
    ...inputMetadataShape,
    modelId: z.string().min(1).optional(),
    objective: z.string().min(1),
    type: z.literal("session.created"),
  })
  .strict();

const SessionStatusInputSchema = z
  .object({
    ...inputMetadataShape,
    from: SessionStatusSchema,
    stopReason: StopReasonSchema.optional(),
    to: SessionStatusSchema,
    type: z.literal("session.status"),
  })
  .strict();

const SessionErrorInputSchema = z
  .object({
    ...inputMetadataShape,
    code: z.string().min(1),
    message: z.string().min(1),
    type: z.literal("session.error"),
  })
  .strict();

const AgentToolUseInputSchema = z
  .object({
    ...inputMetadataShape,
    input: z.record(z.string(), z.unknown()),
    name: z.string().min(1),
    raw: z.unknown().optional(),
    toolUseId: z.string().min(1),
    type: z.literal("agent.tool_use"),
  })
  .strict();

const AgentMessageInputSchema = z
  .object({
    ...inputMetadataShape,
    content: z.string().min(1),
    raw: z.unknown().optional(),
    type: z.literal("agent.message"),
  })
  .strict();

const AgentToolResultInputSchema = z
  .object({
    ...inputMetadataShape,
    content: z.string(),
    isError: z.boolean(),
    toolUseId: z.string().min(1),
    type: z.literal("agent.tool_result"),
  })
  .strict();

const UserMessageInputSchema = z
  .object({
    ...inputMetadataShape,
    content: z.string().min(1),
    type: z.literal("user.message"),
  })
  .strict();

const HarnessCorrectionInputSchema = z
  .object({
    ...inputMetadataShape,
    content: z.string().min(1),
    type: z.literal("harness.correction"),
  })
  .strict();

const HarnessMalformedResponseInputSchema = z
  .object({
    ...inputMetadataShape,
    reason: z.string().min(1),
    type: z.literal("harness.malformed_response"),
  })
  .strict();

const HarnessLimitHitInputSchema = z
  .object({
    ...inputMetadataShape,
    limit: z.enum([
      "max_steps",
      "max_tool_calls",
      "deadline",
      "identical_tool_calls",
    ]),
    type: z.literal("harness.limit_hit"),
  })
  .strict();

const SpanModelRequestInputSchema = z
  .object({
    ...inputMetadataShape,
    attempt: z.number().int().positive(),
    durationMs: z.number().nonnegative(),
    error: z
      .object({ message: z.string().min(1), retryable: z.boolean() })
      .strict()
      .optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    stopReason: ModelStopReasonSchema.optional(),
    type: z.literal("span.model_request"),
  })
  .strict();

const SpanToolAttemptInputSchema = z
  .object({
    ...inputMetadataShape,
    attempt: z.number().int().positive(),
    durationMs: z.number().nonnegative(),
    name: z.string().min(1),
    outcome: z.string().min(1),
    toolUseId: z.string().min(1),
    type: z.literal("span.tool_attempt"),
  })
  .strict();

const UserToolConfirmationInputSchema = z
  .object({
    ...inputMetadataShape,
    denyMessage: z.string().min(1).optional(),
    result: z.enum(["allow", "deny"]),
    toolUseId: z.string().min(1),
    type: z.literal("user.tool_confirmation"),
  })
  .strict();

const ApprovalRequestedInputSchema = z
  .object({
    ...inputMetadataShape,
    input: z.record(z.string(), z.unknown()),
    name: z.string().min(1),
    toolUseId: z.string().min(1),
    type: z.literal("approval.requested"),
  })
  .strict();

const ApprovalDecidedInputSchema = z
  .object({
    ...inputMetadataShape,
    approver: z.enum(["user", "policy"]).optional(),
    denyMessage: z.string().min(1).optional(),
    result: z.enum(["allow", "deny"]),
    toolUseId: z.string().min(1),
    type: z.literal("approval.decided"),
  })
  .strict();

export const NewSessionEventSchema = z.discriminatedUnion("type", [
  AgentMessageInputSchema,
  AgentToolResultInputSchema,
  AgentToolUseInputSchema,
  ApprovalDecidedInputSchema,
  ApprovalRequestedInputSchema,
  HarnessCorrectionInputSchema,
  HarnessMalformedResponseInputSchema,
  HarnessLimitHitInputSchema,
  SessionCreatedInputSchema,
  SessionErrorInputSchema,
  SessionStatusInputSchema,
  SpanModelRequestInputSchema,
  SpanToolAttemptInputSchema,
  UserMessageInputSchema,
  UserToolConfirmationInputSchema,
]);

export const SessionEventSchema = z.discriminatedUnion("type", [
  AgentMessageInputSchema.extend(eventEnvelopeShape),
  AgentToolResultInputSchema.extend(eventEnvelopeShape),
  AgentToolUseInputSchema.extend(eventEnvelopeShape),
  ApprovalDecidedInputSchema.extend(eventEnvelopeShape),
  ApprovalRequestedInputSchema.extend(eventEnvelopeShape),
  HarnessCorrectionInputSchema.extend(eventEnvelopeShape),
  HarnessMalformedResponseInputSchema.extend(eventEnvelopeShape),
  HarnessLimitHitInputSchema.extend(eventEnvelopeShape),
  SessionCreatedInputSchema.extend(eventEnvelopeShape),
  SessionErrorInputSchema.extend(eventEnvelopeShape),
  SessionStatusInputSchema.extend(eventEnvelopeShape),
  SpanModelRequestInputSchema.extend(eventEnvelopeShape),
  SpanToolAttemptInputSchema.extend(eventEnvelopeShape),
  UserMessageInputSchema.extend(eventEnvelopeShape),
  UserToolConfirmationInputSchema.extend(eventEnvelopeShape),
]);

export type NewSessionEvent = z.infer<typeof NewSessionEventSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
