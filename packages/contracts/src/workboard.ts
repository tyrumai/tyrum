import { z } from "zod";
import { ArtifactRef } from "./artifact.js";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { ExecutionBudgets, ExecutionRunId } from "./execution.js";
import { AgentId, TenantId, TyrumKey, WorkspaceId } from "./keys.js";

export const WorkScope = z
  .object({
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
  })
  .strict();
export type WorkScope = z.infer<typeof WorkScope>;

export const WorkItemId = UuidSchema;
export type WorkItemId = z.infer<typeof WorkItemId>;

export const WorkItemKind = z.enum(["action", "initiative"]);
export type WorkItemKind = z.infer<typeof WorkItemKind>;

export const WorkItemState = z.enum([
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "failed",
  "cancelled",
]);
export type WorkItemState = z.infer<typeof WorkItemState>;

export const WorkItemFingerprintResource = z.string().trim().min(1).max(256);
export type WorkItemFingerprintResource = z.infer<typeof WorkItemFingerprintResource>;

export const WorkItemFingerprint = z
  .object({
    resources: z.array(WorkItemFingerprintResource).max(128).default([]),
  })
  .passthrough();
export type WorkItemFingerprint = z.infer<typeof WorkItemFingerprint>;

export const WorkItem = z
  .object({
    work_item_id: WorkItemId,
    tenant_id: TenantId,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    kind: WorkItemKind,
    title: z.string().trim().min(1),
    status: WorkItemState,
    priority: z.number().int().nonnegative(),
    created_at: DateTimeSchema,
    created_from_session_key: TyrumKey,
    last_active_at: DateTimeSchema.nullable(),
    acceptance: z.unknown().optional(),
    fingerprint: WorkItemFingerprint.optional(),
    budgets: ExecutionBudgets.nullable().optional(),
    parent_work_item_id: WorkItemId.nullable().optional(),
    updated_at: DateTimeSchema.optional(),
  })
  .strict();
export type WorkItem = z.infer<typeof WorkItem>;

export const WorkItemTaskId = UuidSchema;
export type WorkItemTaskId = z.infer<typeof WorkItemTaskId>;

export const WorkItemTaskState = z.enum([
  "queued",
  "leased",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
export type WorkItemTaskState = z.infer<typeof WorkItemTaskState>;

export const WorkItemTask = z
  .object({
    task_id: WorkItemTaskId,
    work_item_id: WorkItemId,
    status: WorkItemTaskState,
    depends_on: z.array(WorkItemTaskId).default([]),
    execution_profile: z.string().trim().min(1),
    side_effect_class: z.string().trim().min(1),
    run_id: ExecutionRunId.optional(),
    approval_id: UuidSchema.optional(),
    subagent_id: UuidSchema.optional(),
    pause_reason: z.string().trim().min(1).optional(),
    pause_detail: z.string().trim().min(1).optional(),
    artifacts: z.array(ArtifactRef).default([]),
    started_at: DateTimeSchema.nullable().optional(),
    finished_at: DateTimeSchema.nullable().optional(),
    result_summary: z.string().trim().min(1).optional(),
  })
  .strict();
export type WorkItemTask = z.infer<typeof WorkItemTask>;

export const WorkItemLinkKind = z.enum(["depends_on"]);
export type WorkItemLinkKind = z.infer<typeof WorkItemLinkKind>;

export const WorkItemLink = z
  .object({
    work_item_id: WorkItemId,
    linked_work_item_id: WorkItemId,
    kind: WorkItemLinkKind,
    meta_json: z.unknown(),
    created_at: DateTimeSchema,
  })
  .strict();
export type WorkItemLink = z.infer<typeof WorkItemLink>;
