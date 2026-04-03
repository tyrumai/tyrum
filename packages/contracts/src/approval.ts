import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { TurnItemId } from "./execution.js";
import { AgentId, TyrumKey } from "./keys.js";
import { PolicyOverride } from "./policy-bundle.js";
import { ReviewEntry } from "./review.js";
import { canonicalizeToolId } from "./tool-id.js";
import { ManagedDesktopReference } from "./desktop-environment.js";
import { WorkflowRunStepId } from "./workflow-run.js";

export const ApprovalStatus = z.enum([
  "queued",
  "reviewing",
  "awaiting_human",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalId = UuidSchema;
export type ApprovalId = z.infer<typeof ApprovalId>;

export const ApprovalKey = z.string().trim().min(1);
export type ApprovalKey = z.infer<typeof ApprovalKey>;

export const ApprovalKind = z.enum([
  "workflow_step",
  "intent",
  "retry",
  "policy",
  "budget",
  "takeover",
  "connector.send",
  "work.intervention",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalScope = z
  .object({
    conversation_key: TyrumKey.optional(),
    turn_id: UuidSchema.optional(),
    turn_item_id: TurnItemId.optional(),
    workflow_run_step_id: WorkflowRunStepId.optional(),
    work_item_id: UuidSchema.optional(),
    work_item_task_id: UuidSchema.optional(),
  })
  .strict();
export type ApprovalScope = z.infer<typeof ApprovalScope>;

export const ApprovalDecision = z.enum(["approved", "denied"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const Approval = z
  .object({
    approval_id: ApprovalId,
    approval_key: ApprovalKey,
    agent_id: AgentId.optional(),
    kind: ApprovalKind,
    status: ApprovalStatus,
    prompt: z.string().trim().min(1),
    motivation: z.string().trim().min(1),
    context: z.unknown().optional(),
    scope: ApprovalScope.optional(),
    created_at: DateTimeSchema,
    expires_at: DateTimeSchema.nullable().optional(),
    latest_review: ReviewEntry.nullable(),
    reviews: z.array(ReviewEntry).optional(),
    managed_desktop: ManagedDesktopReference.optional(),
  })
  .strict();
export type Approval = z.infer<typeof Approval>;

export const ApprovalListRequest = z
  .object({
    status: ApprovalStatus.optional(),
    kind: z.array(ApprovalKind).optional(),
    conversation_key: TyrumKey.optional(),
    turn_id: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type ApprovalListRequest = z.infer<typeof ApprovalListRequest>;

export const ApprovalListResponse = z
  .object({
    approvals: z.array(Approval),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type ApprovalListResponse = z.infer<typeof ApprovalListResponse>;

export const ApprovalResolveRequest = z
  .object({
    approval_id: ApprovalId,
    decision: ApprovalDecision,
    reason: z.string().optional(),
    mode: z.enum(["once", "always"]).optional(),
    overrides: z
      .array(
        z
          .object({
            tool_id: z.string().trim().min(1).overwrite(canonicalizeToolId),
            pattern: z.string().trim().min(1),
            workspace_id: z.string().trim().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequest>;

export const ApprovalResolveResponse = z
  .object({
    approval: Approval,
    created_overrides: z.array(PolicyOverride).optional(),
  })
  .strict();
export type ApprovalResolveResponse = z.infer<typeof ApprovalResolveResponse>;
