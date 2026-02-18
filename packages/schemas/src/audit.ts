import { z } from "zod";

export const AuditEvent = z.object({
  id: z.number().int(),
  plan_id: z.string(),
  step_index: z.number().int(),
  occurred_at: z.string(),
  action: z.string(),
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
  exported_at: z.string(),
});
export type ReceiptBundle = z.infer<typeof ReceiptBundle>;
