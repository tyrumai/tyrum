import { z } from "zod";
import { ArtifactRef } from "./artifact.js";
import { DateTimeSchema, UuidSchema } from "./common.js";
import {
  AttemptCost,
  ExecutionBudgets,
  ExecutionStepStatus,
  TurnBlockReason,
  TurnStatus,
  TurnTriggerKind,
} from "./execution.js";
import { AgentId, TenantId, WorkspaceId } from "./keys.js";
import { ActionPrimitive } from "./planner.js";
import { PolicyDecision } from "./policy.js";
import { PolicyOverrideId, PolicySnapshotId } from "./policy-bundle.js";

export const WorkflowRunId = UuidSchema;
export type WorkflowRunId = z.infer<typeof WorkflowRunId>;

export const WorkflowRunStepId = UuidSchema;
export type WorkflowRunStepId = z.infer<typeof WorkflowRunStepId>;

export const WorkflowRunStatus = TurnStatus;
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const WorkflowRunStepStatus = ExecutionStepStatus;
export type WorkflowRunStepStatus = z.infer<typeof WorkflowRunStepStatus>;

export const WorkflowRunTriggerKind = TurnTriggerKind;
export type WorkflowRunTriggerKind = z.infer<typeof WorkflowRunTriggerKind>;

export const WorkflowRunTrigger = z
  .object({
    kind: WorkflowRunTriggerKind,
    metadata: z.unknown().nullable().optional(),
  })
  .strict();
export type WorkflowRunTrigger = z.infer<typeof WorkflowRunTrigger>;

export const WorkflowRun = z
  .object({
    workflow_run_id: WorkflowRunId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    run_key: z.string().trim().min(1),
    conversation_key: z.string().trim().min(1).nullable(),
    status: WorkflowRunStatus,
    trigger: WorkflowRunTrigger,
    plan_id: z.string().trim().min(1).nullable(),
    request_id: z.string().trim().min(1).nullable(),
    input: z.unknown().nullable(),
    budgets: ExecutionBudgets.nullable(),
    policy_snapshot_id: PolicySnapshotId.nullable(),
    attempt: z.number().int().min(1),
    current_step_index: z.number().int().nonnegative().nullable(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    finished_at: DateTimeSchema.nullable(),
    blocked_reason: TurnBlockReason.nullable(),
    blocked_detail: z.string().nullable(),
    budget_overridden_at: DateTimeSchema.nullable(),
    lease_owner: z.string().trim().min(1).nullable(),
    lease_expires_at_ms: z.number().int().nonnegative().nullable(),
    checkpoint: z.unknown().nullable(),
    last_progress_at: DateTimeSchema.nullable(),
    last_progress: z.unknown().nullable(),
  })
  .strict();
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export const WorkflowRunStep = z
  .object({
    tenant_id: TenantId,
    workflow_run_step_id: WorkflowRunStepId,
    workflow_run_id: WorkflowRunId,
    step_index: z.number().int().nonnegative(),
    status: WorkflowRunStepStatus,
    action: ActionPrimitive,
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    finished_at: DateTimeSchema.nullable(),
    idempotency_key: z.string().trim().min(1).nullable(),
    postcondition: z.unknown().nullable(),
    result: z.unknown().nullable(),
    error: z.string().nullable(),
    artifacts: z.array(ArtifactRef),
    metadata: z.unknown().nullable(),
    cost: AttemptCost.nullable(),
    policy_snapshot_id: PolicySnapshotId.nullable(),
    policy_decision: PolicyDecision.nullable(),
    policy_applied_override_ids: z.array(PolicyOverrideId).nullable(),
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    timeout_ms: z.number().int().positive(),
  })
  .strict();
export type WorkflowRunStep = z.infer<typeof WorkflowRunStep>;
