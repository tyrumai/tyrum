import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { Lane, TyrumKey } from "./keys.js";
import { ActionPrimitive } from "./planner.js";
import { ArtifactRef } from "./artifact.js";
import { PostconditionReport } from "./postcondition.js";

export const ExecutionJobId = UuidSchema;
export type ExecutionJobId = z.infer<typeof ExecutionJobId>;

export const ExecutionRunId = UuidSchema;
export type ExecutionRunId = z.infer<typeof ExecutionRunId>;

export const ExecutionStepId = UuidSchema;
export type ExecutionStepId = z.infer<typeof ExecutionStepId>;

export const ExecutionAttemptId = UuidSchema;
export type ExecutionAttemptId = z.infer<typeof ExecutionAttemptId>;

export const ExecutionRunStatus = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type ExecutionRunStatus = z.infer<typeof ExecutionRunStatus>;

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

export const ExecutionJobStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type ExecutionJobStatus = z.infer<typeof ExecutionJobStatus>;

export const ExecutionTrigger = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("session"),
      key: TyrumKey,
      lane: Lane,
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("cron"),
      key: TyrumKey,
      lane: Lane.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hook"),
      key: TyrumKey,
      lane: Lane.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("manual"),
      key: TyrumKey.optional(),
      lane: Lane.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("api"),
      key: TyrumKey.optional(),
      lane: Lane.optional(),
      metadata: z.unknown().optional(),
    })
    .strict(),
]);
export type ExecutionTrigger = z.infer<typeof ExecutionTrigger>;

export const ExecutionJob = z
  .object({
    job_id: ExecutionJobId,
    key: TyrumKey,
    lane: Lane,
    status: ExecutionJobStatus,
    created_at: DateTimeSchema,
    trigger: ExecutionTrigger,
    input: z.unknown().optional(),
    latest_run_id: ExecutionRunId.optional(),
  })
  .strict();
export type ExecutionJob = z.infer<typeof ExecutionJob>;

export const ExecutionPauseReason = z.enum([
  "approval",
  "takeover",
  "budget",
  "manual",
  "policy",
]);
export type ExecutionPauseReason = z.infer<typeof ExecutionPauseReason>;

export const ExecutionRunPausedPayload = z
  .object({
    run_id: ExecutionRunId,
    reason: ExecutionPauseReason,
    approval_id: z.number().int().positive().optional(),
    detail: z.string().optional(),
  })
  .strict();
export type ExecutionRunPausedPayload = z.infer<typeof ExecutionRunPausedPayload>;

export const ExecutionRun = z
  .object({
    run_id: ExecutionRunId,
    job_id: ExecutionJobId,
    key: TyrumKey,
    lane: Lane,
    status: ExecutionRunStatus,
    attempt: z.number().int().min(1),
    created_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    finished_at: DateTimeSchema.nullable(),
  })
  .strict();
export type ExecutionRun = z.infer<typeof ExecutionRun>;

export const ExecutionStep = z
  .object({
    step_id: ExecutionStepId,
    run_id: ExecutionRunId,
    step_index: z.number().int().nonnegative(),
    status: ExecutionStepStatus,
    action: ActionPrimitive,
    created_at: DateTimeSchema,
    idempotency_key: z.string().trim().min(1).optional(),
    postcondition: z.unknown().optional(),
    approval_id: z.number().int().positive().optional(),
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
  })
  .strict();
export type ExecutionAttempt = z.infer<typeof ExecutionAttempt>;

