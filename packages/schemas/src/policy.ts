import { z } from "zod";
import { UuidSchema } from "./common.js";

export const Decision = z.enum(["approve", "escalate", "deny"]);
export type Decision = z.infer<typeof Decision>;

export const RuleKind = z.enum([
  "spend_limit",
  "pii_guardrail",
  "legal_compliance",
  "connector_scope",
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

// ---------------------------------------------------------------------------
// Policy bundles (structured rule sets)
// ---------------------------------------------------------------------------

export const PolicyDomain = z.enum([
  "egress",
  "secrets",
  "messaging",
  "tools",
  "artifacts",
  "spend",
  "pii",
  "legal",
]);
export type PolicyDomain = z.infer<typeof PolicyDomain>;

export const PolicyAction = z.enum(["deny", "require_approval", "allow"]);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const PolicyPrecedence = z.enum(["deployment", "agent", "playbook"]);
export type PolicyPrecedence = z.infer<typeof PolicyPrecedence>;

export const PolicyRule = z
  .object({
    domain: PolicyDomain,
    action: PolicyAction,
    conditions: z.unknown().optional(),
    priority: z.number().int(),
    description: z.string().optional(),
  })
  .strict();
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyBundle = z
  .object({
    rules: z.array(PolicyRule),
    precedence: PolicyPrecedence,
    version: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type PolicyBundle = z.infer<typeof PolicyBundle>;

// ---------------------------------------------------------------------------
// Policy overrides (approve-always durable records)
// ---------------------------------------------------------------------------

export const PolicyOverrideStatus = z.enum(["active", "revoked", "expired"]);
export type PolicyOverrideStatus = z.infer<typeof PolicyOverrideStatus>;

export const PolicyOverride = z
  .object({
    policy_override_id: z.string().trim().min(1),
    status: PolicyOverrideStatus,
    agent_id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1).optional(),
    tool_id: z.string().trim().min(1),
    pattern: z.string().min(1),
    created_at: z.string(),
    created_by: z.string().optional(),
    created_from_approval_id: z.number().int().positive().optional(),
    created_from_policy_snapshot_id: UuidSchema.optional(),
    expires_at: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
    revoked_by: z.string().nullable().optional(),
    revoked_reason: z.string().nullable().optional(),
  })
  .strict();
export type PolicyOverride = z.infer<typeof PolicyOverride>;
