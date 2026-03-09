import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { Lane, TyrumKey } from "./keys.js";
import { PolicyOverride } from "./policy-bundle.js";
import { canonicalizeToolId } from "./tool-id.js";

export const ApprovalStatus = z.enum(["pending", "approved", "denied", "expired", "cancelled"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalId = UuidSchema;
export type ApprovalId = z.infer<typeof ApprovalId>;

export const ApprovalKey = z.string().trim().min(1);
export type ApprovalKey = z.infer<typeof ApprovalKey>;

export const ApprovalKind = z.enum([
  "spend",
  "pii",
  "workflow_step",
  "intent",
  "retry",
  "policy",
  "budget",
  "pairing",
  "takeover",
  "connector.send",
  "other",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalScope = z
  .object({
    key: TyrumKey.optional(),
    lane: Lane.optional(),
    run_id: UuidSchema.optional(),
    step_id: UuidSchema.optional(),
    attempt_id: UuidSchema.optional(),
    work_item_id: UuidSchema.optional(),
    work_item_task_id: UuidSchema.optional(),
  })
  .strict();
export type ApprovalScope = z.infer<typeof ApprovalScope>;

export const ApprovalDecision = z.enum(["approved", "denied"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalResolution = z
  .object({
    decision: ApprovalDecision,
    resolved_at: DateTimeSchema,
    resolved_by: z.unknown().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type ApprovalResolution = z.infer<typeof ApprovalResolution>;

export const Approval = z
  .object({
    approval_id: ApprovalId,
    approval_key: ApprovalKey,
    kind: ApprovalKind,
    status: ApprovalStatus,
    prompt: z.string().trim().min(1),
    context: z.unknown().optional(),
    scope: ApprovalScope.optional(),
    created_at: DateTimeSchema,
    expires_at: DateTimeSchema.nullable().optional(),
    resolution: ApprovalResolution.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasResolution = value.resolution !== null;
    if (value.status === "pending" && hasResolution) {
      ctx.addIssue({
        code: "custom",
        message: "pending approvals must have resolution: null",
        path: ["resolution"],
      });
    }
    if (value.status !== "pending" && !hasResolution) {
      ctx.addIssue({
        code: "custom",
        message: "non-pending approvals must include a resolution",
        path: ["resolution"],
      });
    }
  });
export type Approval = z.infer<typeof Approval>;

export const ApprovalListRequest = z
  .object({
    status: ApprovalStatus.optional(),
    kind: z.array(ApprovalKind).optional(),
    key: TyrumKey.optional(),
    lane: Lane.optional(),
    run_id: z.string().trim().min(1).optional(),
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
