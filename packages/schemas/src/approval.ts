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

export const ApprovalMode = z.enum(["once", "always"]);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

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

export const ApprovalSuggestedOverride = z
  .object({
    tool_id: z.string().trim().min(1),
    pattern: z.string().trim().min(1),
    agent_id: z.string().trim().min(1).optional(),
    workspace_id: z.string().trim().min(1).optional(),
    /** Optional example of the per-tool match target for this suggestion (for operator UX). */
    match_target: z.string().trim().min(1).optional(),
  })
  .strict();
export type ApprovalSuggestedOverride = z.infer<typeof ApprovalSuggestedOverride>;

export const ApprovalOverrideSelection = z
  .object({
    tool_id: z.string().trim().min(1),
    pattern: z.string().trim().min(1),
  })
  .strict();
export type ApprovalOverrideSelection = z.infer<typeof ApprovalOverrideSelection>;

export const ApprovalDecision = z.enum(["approved", "denied"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalResolution = z
  .object({
    decision: ApprovalDecision,
    resolved_at: DateTimeSchema,
    resolved_by: z.unknown().optional(),
    reason: z.string().optional(),
    mode: ApprovalMode.optional(),
    policy_override_id: z.string().trim().min(1).optional(),
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
    suggested_overrides: z.array(ApprovalSuggestedOverride).max(10).optional(),
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

    if (value.resolution) {
      const { decision, mode, policy_override_id: overrideId } = value.resolution;
      if (decision !== "approved") {
        if (mode !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: "mode is only valid for approved resolutions",
            path: ["resolution", "mode"],
          });
        }
        if (overrideId !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: "policy_override_id is only valid for approved resolutions",
            path: ["resolution", "policy_override_id"],
          });
        }
      }
      if (mode === "always" && !overrideId) {
        ctx.addIssue({
          code: "custom",
          message: "policy_override_id is required when mode=always",
          path: ["resolution", "policy_override_id"],
        });
      }
      if (mode === "once" && overrideId) {
        ctx.addIssue({
          code: "custom",
          message: "policy_override_id must be omitted when mode=once",
          path: ["resolution", "policy_override_id"],
        });
      }
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
    mode: ApprovalMode.optional(),
    selected_override: ApprovalOverrideSelection.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "always") {
      if (value.decision !== "approved") {
        ctx.addIssue({
          code: "custom",
          message: "mode=always is only valid when decision=approved",
          path: ["mode"],
        });
      }
      if (!value.selected_override) {
        ctx.addIssue({
          code: "custom",
          message: "selected_override is required when mode=always",
          path: ["selected_override"],
        });
      }
    }
    if (value.selected_override && value.mode !== "always") {
      ctx.addIssue({
        code: "custom",
        message: "selected_override is only valid when mode=always",
        path: ["selected_override"],
      });
    }
  });
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequest>;

export const ApprovalResolveResponse = z
  .object({
    approval: Approval,
  })
  .strict();
export type ApprovalResolveResponse = z.infer<typeof ApprovalResolveResponse>;
