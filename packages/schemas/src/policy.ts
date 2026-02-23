import { z } from "zod";

// Canonical policy decision vocabulary (docs/architecture/sandbox-policy.md).
export const Decision = z.enum(["allow", "require_approval", "deny"]);
export type Decision = z.infer<typeof Decision>;

export const RuleKind = z.enum([
  "spend_limit",
  "pii_guardrail",
  "legal_compliance",
  "connector_scope",
  // Tool-policy domains (docs/architecture/sandbox-policy.md, tools.md).
  "tool_policy",
  "network_egress",
  "secrets",
  "provenance",
  "policy_override",
]);
export type RuleKind = z.infer<typeof RuleKind>;

export const RuleDecision = z.object({
  rule: RuleKind,
  outcome: Decision,
  detail: z.string(),
});
export type RuleDecision = z.infer<typeof RuleDecision>;

export const PolicyDecision = z.object({
  decision: Decision,
  rules: z.array(RuleDecision),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export const PiiCategory = z.enum([
  "basic_contact",
  "location",
  "financial",
  "health",
  "biometric",
  "government_id",
  "other",
]);
export type PiiCategory = z.infer<typeof PiiCategory>;

export const LegalFlag = z.enum([
  "prohibited_content",
  "requires_review",
  "terms_unknown",
  "export_controlled",
  "other",
]);
export type LegalFlag = z.infer<typeof LegalFlag>;

export const SpendContext = z.object({
  amount_minor_units: z.number().int().nonnegative(),
  currency: z.string(),
  user_limit_minor_units: z.number().int().nonnegative().optional(),
});
export type SpendContext = z.infer<typeof SpendContext>;

export const PiiContext = z.object({
  categories: z.array(PiiCategory).default([]),
});
export type PiiContext = z.infer<typeof PiiContext>;

export const LegalContext = z.object({
  flags: z.array(LegalFlag).default([]),
});
export type LegalContext = z.infer<typeof LegalContext>;

export const ConnectorScopeContext = z.object({
  scope: z.string().trim().optional(),
});
export type ConnectorScopeContext = z.infer<typeof ConnectorScopeContext>;

export const PolicyCheckRequest = z.object({
  request_id: z.string().optional(),
  spend: SpendContext.optional(),
  pii: PiiContext.optional(),
  legal: LegalContext.optional(),
  connector: ConnectorScopeContext.optional(),
});
export type PolicyCheckRequest = z.infer<typeof PolicyCheckRequest>;
