import { z } from "zod";

export const AuthorizationDecision = z.enum(["approve", "escalate", "deny"]);
export type AuthorizationDecision = z.infer<typeof AuthorizationDecision>;

export const MerchantContext = z.object({
  name: z.string().optional(),
  mcc: z.string().optional(),
  country: z.string().optional(),
});
export type MerchantContext = z.infer<typeof MerchantContext>;

export const SpendAuthorizeRequest = z.object({
  request_id: z.string().optional(),
  card_id: z.string().optional(),
  amount_minor_units: z.number().int().nonnegative(),
  currency: z.string(),
  merchant: MerchantContext.optional(),
});
export type SpendAuthorizeRequest = z.infer<typeof SpendAuthorizeRequest>;

export const AuthorizationLimits = z.object({
  auto_approve_minor_units: z.number().int().nonnegative(),
  hard_deny_minor_units: z.number().int().nonnegative(),
});
export type AuthorizationLimits = z.infer<typeof AuthorizationLimits>;

export const SpendAuthorizeResponse = z.object({
  request_id: z.string().optional(),
  decision: AuthorizationDecision,
  reason: z.string(),
  limits: AuthorizationLimits,
});
export type SpendAuthorizeResponse = z.infer<typeof SpendAuthorizeResponse>;

export const Thresholds = z.object({
  auto_approve_minor_units: z.number().int().nonnegative(),
  hard_deny_minor_units: z.number().int().nonnegative(),
});
export type Thresholds = z.infer<typeof Thresholds>;
