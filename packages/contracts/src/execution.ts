import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { TyrumKey } from "./keys.js";
import { ActionPrimitive } from "./planner.js";
import { ArtifactRef } from "./artifact.js";
import { PostconditionReport } from "./postcondition.js";
import { PolicyDecision } from "./policy.js";
import { PolicyOverrideId, PolicySnapshotId } from "./policy-bundle.js";
import { TyrumUIMessage } from "./ui-message.js";

export const TurnJobId = UuidSchema;
export type TurnJobId = z.infer<typeof TurnJobId>;

export const TurnId = UuidSchema;
export type TurnId = z.infer<typeof TurnId>;

export const TurnItemId = UuidSchema;
export type TurnItemId = z.infer<typeof TurnItemId>;

export const ExecutionStepId = UuidSchema;
export type ExecutionStepId = z.infer<typeof ExecutionStepId>;

export const ExecutionAttemptId = UuidSchema;
export type ExecutionAttemptId = z.infer<typeof ExecutionAttemptId>;

export const TurnStatus = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type TurnStatus = z.infer<typeof TurnStatus>;

export const ExecutionStepStatus = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);
export type ExecutionStepStatus = z.infer<typeof ExecutionStepStatus>;

export const ExecutionAttemptStatus = z.enum([
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
]);
export type ExecutionAttemptStatus = z.infer<typeof ExecutionAttemptStatus>;

/**
 * Attempt-level cost attribution.
 *
 * This is intentionally permissive and optional; not all executors can report
 * all fields (e.g., token usage may be missing for non-LLM steps).
 */
export const AttemptCost = z
  .object({
    /** Wall-clock duration for the attempt (end - start). */
    duration_ms: z.number().int().nonnegative().optional(),
    /** Token counts for LLM-backed steps (when available). */
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    /** Cost in micro-dollars (USD * 1e6) when pricing is known. */
    usd_micros: z.number().int().nonnegative().optional(),
    /** Optional model identifier (e.g. "gpt-4.1-mini"). */
    model: z.string().trim().min(1).optional(),
    /** Optional provider identifier (e.g. "openai", "anthropic"). */
    provider: z.string().trim().min(1).optional(),
    /** Extra executor/provider-specific metadata. */
    metadata: z.unknown().optional(),
  })
  .strict();
export type AttemptCost = z.infer<typeof AttemptCost>;

/**
 * Turn budgets (optional).
 *
 * Budgets are ceilings: when exceeded, execution pauses with reason "budget"
 * (and can be overridden by an operator approval).
 */
export const ExecutionBudgets = z
  .object({
    /** Maximum cost for the turn in USD micros (USD * 1e6). */
    max_usd_micros: z.number().int().nonnegative().optional(),
    /** Maximum wall-clock duration for the turn (ms since started_at). */
    max_duration_ms: z.number().int().positive().optional(),
    /** Maximum total LLM tokens consumed by the turn (when available). */
    max_total_tokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ExecutionBudgets = z.infer<typeof ExecutionBudgets>;

export const TurnJobStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type TurnJobStatus = z.infer<typeof TurnJobStatus>;

export const TurnTriggerKind = z.enum([
  "conversation",
  "cron",
  "heartbeat",
  "hook",
  "webhook",
  "manual",
  "api",
]);
export type TurnTriggerKind = z.infer<typeof TurnTriggerKind>;

export const TurnTrigger = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.conversation),
      conversation_key: TyrumKey,
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.cron),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.heartbeat),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.hook),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.webhook),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.manual),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(TurnTriggerKind.enum.api),
      conversation_key: TyrumKey.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
]);
export type TurnTrigger = z.infer<typeof TurnTrigger>;

export const TurnJob = z
  .object({
    job_id: TurnJobId,
    conversation_key: TyrumKey,
    status: TurnJobStatus,
    created_at: DateTimeSchema,
    trigger: TurnTrigger,
    input: z.unknown().optional(),
    latest_turn_id: TurnId.optional(),
  })
  .strict();
export type TurnJob = z.infer<typeof TurnJob>;

export const TurnBlockReason = z.enum(["approval", "takeover", "budget", "manual", "policy"]);
export type TurnBlockReason = z.infer<typeof TurnBlockReason>;

export const TurnBlockedPayload = z
  .object({
    turn_id: TurnId,
    reason: TurnBlockReason,
    approval_id: UuidSchema.optional(),
    detail: z.string().optional(),
  })
  .strict();
export type TurnBlockedPayload = z.infer<typeof TurnBlockedPayload>;

export const Turn = z
  .object({
    turn_id: TurnId,
    job_id: TurnJobId,
    conversation_key: TyrumKey,
    status: TurnStatus,
    attempt: z.number().int().min(1),
    created_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    finished_at: DateTimeSchema.nullable(),
    blocked_reason: TurnBlockReason.optional(),
    blocked_detail: z.string().optional(),
    policy_snapshot_id: UuidSchema.optional(),
    budgets: ExecutionBudgets.optional(),
    budget_overridden_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type Turn = z.infer<typeof Turn>;

export const TurnItemKind = z.enum(["message"]);
export type TurnItemKind = z.infer<typeof TurnItemKind>;

const TurnItemBase = z
  .object({
    turn_item_id: TurnItemId,
    turn_id: TurnId,
    item_index: z.number().int().nonnegative(),
    item_key: z.string().trim().min(1),
    created_at: DateTimeSchema,
  })
  .strict();

export const TurnMessageItem = TurnItemBase.extend({
  kind: z.literal(TurnItemKind.enum.message),
  payload: z
    .object({
      message: TyrumUIMessage,
    })
    .strict(),
}).strict();
export type TurnMessageItem = z.infer<typeof TurnMessageItem>;

export const TurnItem = z.discriminatedUnion("kind", [TurnMessageItem]);
export type TurnItem = z.infer<typeof TurnItem>;

export const ExecutionStep = z
  .object({
    step_id: ExecutionStepId,
    turn_id: TurnId,
    step_index: z.number().int().nonnegative(),
    status: ExecutionStepStatus,
    action: ActionPrimitive,
    created_at: DateTimeSchema,
    idempotency_key: z.string().trim().min(1).optional(),
    postcondition: z.unknown().optional(),
    approval_id: UuidSchema.optional(),
  })
  .strict();
export type ExecutionStep = z.infer<typeof ExecutionStep>;

export const ExecutionAttempt = z
  .object({
    attempt_id: ExecutionAttemptId,
    step_id: ExecutionStepId,
    attempt: z.number().int().min(1),
    status: ExecutionAttemptStatus,
    started_at: DateTimeSchema,
    finished_at: DateTimeSchema.nullable(),
    result: z.unknown().optional(),
    error: z.string().nullable(),
    postcondition_report: PostconditionReport.optional(),
    artifacts: z.array(ArtifactRef).default([]),
    cost: AttemptCost.optional(),
    metadata: z.unknown().optional(),
    policy_snapshot_id: PolicySnapshotId.optional(),
    policy_decision: PolicyDecision.optional(),
    policy_applied_override_ids: z.array(PolicyOverrideId).optional(),
  })
  .strict();
export type ExecutionAttempt = z.infer<typeof ExecutionAttempt>;
