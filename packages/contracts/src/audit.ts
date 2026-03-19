import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const AuditPlanSummary = z
  .object({
    plan_key: z.string(),
    plan_id: z.string(),
    kind: z.string(),
    status: z.string(),
    event_count: z.number().int().nonnegative(),
    last_event_at: DateTimeSchema,
  })
  .strict();
export type AuditPlanSummary = z.infer<typeof AuditPlanSummary>;

export const AuditPlansListResponse = z
  .object({
    status: z.literal("ok"),
    plans: z.array(AuditPlanSummary),
  })
  .strict();
export type AuditPlansListResponse = z.infer<typeof AuditPlansListResponse>;

export const AuditEvent = z.object({
  id: z.number().int(),
  plan_id: z.string(),
  step_index: z.number().int(),
  occurred_at: DateTimeSchema,
  action: z.unknown(),
  prev_hash: z.string().nullable(),
  event_hash: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const ChainVerification = z.object({
  valid: z.boolean(),
  checked_count: z.number().int(),
  broken_at_index: z.number().int().nullable(),
  broken_at_id: z.number().int().nullable(),
});
export type ChainVerification = z.infer<typeof ChainVerification>;

export const ReceiptBundle = z.object({
  plan_id: z.string(),
  events: z.array(AuditEvent),
  chain_verification: ChainVerification,
  exported_at: DateTimeSchema,
});
export type ReceiptBundle = z.infer<typeof ReceiptBundle>;

export const AuditForgetDecision = z.enum(["delete", "anonymize", "retain"]);
export type AuditForgetDecision = z.infer<typeof AuditForgetDecision>;

export const AuditForgetRequest = z
  .object({
    confirm: z.literal("FORGET"),
    entity_type: z.string().trim().min(1),
    entity_id: z.string().trim().min(1),
    decision: AuditForgetDecision,
  })
  .strict();
export type AuditForgetRequest = z.infer<typeof AuditForgetRequest>;

export const AuditForgetResponse = z
  .object({
    decision: AuditForgetDecision,
    deleted_count: z.number().int().nonnegative(),
    proof_event_id: z.number().int().nonnegative(),
  })
  .strict();
export type AuditForgetResponse = z.infer<typeof AuditForgetResponse>;
