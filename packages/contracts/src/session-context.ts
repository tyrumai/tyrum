import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const CheckpointSummary = z
  .object({
    goal: z.string(),
    user_constraints: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    discoveries: z.array(z.string()).default([]),
    completed_work: z.array(z.string()).default([]),
    pending_work: z.array(z.string()).default([]),
    unresolved_questions: z.array(z.string()).default([]),
    critical_identifiers: z.array(z.string()).default([]),
    relevant_files: z.array(z.string()).default([]),
    handoff_md: z.string(),
  })
  .strict();
export type CheckpointSummary = z.infer<typeof CheckpointSummary>;

export const PendingApprovalState = z
  .object({
    approval_id: z.string().trim().min(1),
    approved: z.boolean().optional(),
    state: z.enum(["approved", "cancelled", "denied", "expired", "pending"]),
    tool_call_id: z.string().trim().min(1),
    tool_name: z.string().trim().min(1),
  })
  .strict();
export type PendingApprovalState = z.infer<typeof PendingApprovalState>;

export const PendingToolState = z
  .object({
    summary: z.string(),
    tool_call_id: z.string().trim().min(1),
    tool_name: z.string().trim().min(1),
  })
  .strict();
export type PendingToolState = z.infer<typeof PendingToolState>;

export const SessionContextState = z
  .object({
    version: z.literal(1),
    compacted_through_message_id: z.string().trim().min(1).optional(),
    recent_message_ids: z.array(z.string().trim().min(1)).default([]),
    checkpoint: CheckpointSummary.nullable().default(null),
    pending_approvals: z.array(PendingApprovalState).default([]),
    pending_tool_state: z.array(PendingToolState).default([]),
    updated_at: DateTimeSchema,
  })
  .strict();
export type SessionContextState = z.infer<typeof SessionContextState>;
