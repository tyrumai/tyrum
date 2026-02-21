import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import {
  ExecutionRunId,
  ExecutionStepId,
  ExecutionAttemptId,
  ExecutionRunStatus,
  ExecutionStepStatus,
} from "./execution.js";

export const GatewayEventKind = z.enum([
  "run.queued",
  "run.started",
  "run.completed",
  "run.failed",
  "run.paused",
  "run.cancelled",
  "step.started",
  "step.completed",
  "step.failed",
  "step.paused",
  "approval.requested",
  "approval.resolved",
  "presence.online",
  "presence.offline",
  "watcher.fired",
]);
export type GatewayEventKind = z.infer<typeof GatewayEventKind>;

export const GatewayEventEnvelope = z
  .object({
    event_id: UuidSchema,
    kind: GatewayEventKind,
    occurred_at: DateTimeSchema,
    payload: z.unknown(),
  })
  .strict();
export type GatewayEventEnvelope = z.infer<typeof GatewayEventEnvelope>;

export const RunLifecyclePayload = z
  .object({
    run_id: ExecutionRunId,
    status: ExecutionRunStatus,
    detail: z.string().optional(),
  })
  .strict();
export type RunLifecyclePayload = z.infer<typeof RunLifecyclePayload>;

export const StepLifecyclePayload = z
  .object({
    run_id: ExecutionRunId,
    step_id: ExecutionStepId,
    step_index: z.number().int().nonnegative(),
    status: ExecutionStepStatus,
    attempt_id: ExecutionAttemptId.optional(),
    detail: z.string().optional(),
  })
  .strict();
export type StepLifecyclePayload = z.infer<typeof StepLifecyclePayload>;

export const ApprovalLifecyclePayload = z
  .object({
    approval_id: z.number().int().positive(),
    run_id: ExecutionRunId.optional(),
    step_id: ExecutionStepId.optional(),
    status: z.enum(["requested", "resolved"]),
    decision: z.enum(["approved", "denied"]).optional(),
  })
  .strict();
export type ApprovalLifecyclePayload = z.infer<typeof ApprovalLifecyclePayload>;

export const WatcherFiredPayload = z
  .object({
    watcher_id: z.number().int().positive(),
    plan_id: z.string().min(1).optional(),
    run_id: ExecutionRunId.optional(),
    trigger_type: z.string().min(1),
  })
  .strict();
export type WatcherFiredPayload = z.infer<typeof WatcherFiredPayload>;
