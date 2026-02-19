import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { Lane, TyrumKey } from "./keys.js";

export const ApprovalStatus = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalKind = z.enum([
  "spend",
  "pii",
  "workflow_step",
  "pairing",
  "takeover",
  "other",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalScope = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    key: TyrumKey.optional(),
    lane: Lane.optional(),
    run_id: z.string().trim().min(1).optional(),
    step_index: z.number().int().nonnegative().optional(),
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
    approval_id: z.number().int().positive(),
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
    approval_id: z.number().int().positive(),
    decision: ApprovalDecision,
    reason: z.string().optional(),
  })
  .strict();
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequest>;

export const ApprovalResolveResponse = z
  .object({
    approval: Approval,
  })
  .strict();
export type ApprovalResolveResponse = z.infer<typeof ApprovalResolveResponse>;

