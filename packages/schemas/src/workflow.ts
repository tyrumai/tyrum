import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { TyrumKey, Lane, QueueMode } from "./keys.js";
import { ActionPrimitive } from "./planner.js";
import { ExecutionRunId, ExecutionRunStatus, ExecutionTrigger } from "./execution.js";

export const WorkflowRunRequest = z
  .object({
    key: TyrumKey,
    lane: Lane.default("main"),
    steps: z.array(ActionPrimitive).min(1),
    trigger: ExecutionTrigger,
    idempotency_key: z.string().trim().min(1).optional(),
    budget_tokens: z.number().int().positive().optional(),
    queue_mode: QueueMode.optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type WorkflowRunRequest = z.infer<typeof WorkflowRunRequest>;

export const WorkflowResumeRequest = z
  .object({
    run_id: ExecutionRunId,
    resume_token: z.string().min(1),
  })
  .strict();
export type WorkflowResumeRequest = z.infer<typeof WorkflowResumeRequest>;

export const WorkflowCancelRequest = z
  .object({
    run_id: ExecutionRunId,
    reason: z.string().optional(),
  })
  .strict();
export type WorkflowCancelRequest = z.infer<typeof WorkflowCancelRequest>;

export const WorkflowRunStatus = z
  .object({
    run_id: ExecutionRunId,
    status: ExecutionRunStatus,
    created_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    finished_at: DateTimeSchema.nullable(),
    step_count: z.number().int().nonnegative(),
    steps_completed: z.number().int().nonnegative(),
    budget_tokens: z.number().int().positive().nullable(),
    spent_tokens: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;
