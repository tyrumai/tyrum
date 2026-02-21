import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const PolicyOverrideStatus = z.enum(["active", "revoked", "expired"]);
export type PolicyOverrideStatus = z.infer<typeof PolicyOverrideStatus>;

export const PolicyOverride = z
  .object({
    policy_override_id: z.string().trim().min(1),
    status: PolicyOverrideStatus,
    created_at: DateTimeSchema,
    created_by: z.unknown().optional(),
    agent_id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1).nullable().optional(),
    tool_id: z.string().trim().min(1),
    pattern: z.string().trim().min(1),
    created_from_approval_id: z.number().int().positive().nullable().optional(),
    created_from_policy_snapshot_id: z.string().trim().min(1).nullable().optional(),
    expires_at: DateTimeSchema.nullable().optional(),
    revoked_at: DateTimeSchema.nullable().optional(),
    revoked_by: z.unknown().nullable().optional(),
    revoked_reason: z.string().nullable().optional(),
  })
  .strict();
export type PolicyOverride = z.infer<typeof PolicyOverride>;

