/**
 * Policy engine — port of services/policy/src/lib.rs
 *
 * Pure functions implementing the four policy rules: spend limit,
 * PII guardrail, legal compliance, and connector scope.
 */

import type {
  Decision,
  RuleDecision,
  PolicyDecision,
  PiiCategory,
  LegalFlag,
  PolicySpendContext,
  PiiContext,
  LegalContext,
  ConnectorScopeContext,
  PolicyCheckRequest,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_APPROVE_LIMIT_MINOR = 10_000;
const HARD_DENY_LIMIT_MINOR = 50_000;

const AUTO_APPROVE_SCOPES: readonly string[] = [
  "mcp://calendar",
  "mcp://crm",
  "mcp://email",
  "mcp://files",
  "mcp://support",
  "mcp://tasks",
];

const HARD_DENY_SCOPES: readonly string[] = [
  "mcp://root",
  "mcp://secrets",
  "mcp://admin",
];

export function currencyMinorUnits(currency: string): number {
  const upper = currency.toUpperCase();
  const zeroDecimal = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  ]);
  const threeDecimal = new Set([
    "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
  ]);
  if (zeroDecimal.has(upper)) return 0;
  if (threeDecimal.has(upper)) return 3;
  return 2;
}

export function formatMoney(amountMinor: number, currency: string): string {
  const decimals = currencyMinorUnits(currency);
  const divisor = Math.pow(10, decimals);
  const major = amountMinor / divisor;
  return `${currency.toUpperCase()} ${major.toFixed(decimals)}`;
}

function describeCategories(categories: readonly PiiCategory[]): string {
  return categories.join(", ");
}

function describeLegalFlags(flags: readonly LegalFlag[]): string {
  return flags.join(", ");
}

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

export function evaluateSpend(ctx?: PolicySpendContext): RuleDecision {
  if (ctx == null) {
    return {
      rule: "spend_limit",
      outcome: "require_approval",
      detail: "Spend context missing; escalate for confirmation.",
    };
  }

  const amount = ctx.amount_minor_units;
  const userLimit = ctx.user_limit_minor_units ?? AUTO_APPROVE_LIMIT_MINOR;

  if (amount > HARD_DENY_LIMIT_MINOR) {
    return {
      rule: "spend_limit",
      outcome: "deny",
      detail: `Amount ${formatMoney(amount, ctx.currency)} exceeds hard limit ${formatMoney(HARD_DENY_LIMIT_MINOR, ctx.currency)}.`,
    };
  }

  if (amount > userLimit) {
    return {
      rule: "spend_limit",
      outcome: "require_approval",
      detail: `Amount ${formatMoney(amount, ctx.currency)} exceeds user limit ${formatMoney(userLimit, ctx.currency)}.`,
    };
  }

  return {
    rule: "spend_limit",
    outcome: "allow",
    detail: `Amount ${formatMoney(amount, ctx.currency)} within auto-approval limit ${formatMoney(userLimit, ctx.currency)}.`,
  };
}

export function evaluatePii(ctx?: PiiContext): RuleDecision {
  if (ctx == null) {
    return {
      rule: "pii_guardrail",
      outcome: "require_approval",
      detail: "PII context missing; escalate to request confirmation.",
    };
  }

  if (ctx.categories.length === 0) {
    return {
      rule: "pii_guardrail",
      outcome: "allow",
      detail: "No PII categories declared.",
    };
  }

  const hasBiometricOrGovId = ctx.categories.some(
    (cat) => cat === "biometric" || cat === "government_id",
  );
  if (hasBiometricOrGovId) {
    return {
      rule: "pii_guardrail",
      outcome: "deny",
      detail: `Detected protected PII categories: ${describeCategories(ctx.categories)}.`,
    };
  }

  const hasFinancialOrHealth = ctx.categories.some(
    (cat) => cat === "financial" || cat === "health",
  );
  if (hasFinancialOrHealth) {
    return {
      rule: "pii_guardrail",
      outcome: "require_approval",
      detail: `Detected sensitive PII categories requiring consent: ${describeCategories(ctx.categories)}.`,
    };
  }

  return {
    rule: "pii_guardrail",
    outcome: "allow",
    detail: `PII categories acceptable for automated handling: ${describeCategories(ctx.categories)}.`,
  };
}

export function evaluateLegal(ctx?: LegalContext): RuleDecision {
  if (ctx == null) {
    return {
      rule: "legal_compliance",
      outcome: "require_approval",
      detail: "Legal context missing; escalate for review.",
    };
  }

  if (ctx.flags.length === 0) {
    return {
      rule: "legal_compliance",
      outcome: "allow",
      detail: "No legal flags raised.",
    };
  }

  const hasProhibited = ctx.flags.some(
    (flag) => flag === "prohibited_content",
  );
  if (hasProhibited) {
    return {
      rule: "legal_compliance",
      outcome: "deny",
      detail: `Prohibited legal flags present: ${describeLegalFlags(ctx.flags)}.`,
    };
  }

  const hasEscalating = ctx.flags.some(
    (flag) =>
      flag === "requires_review" ||
      flag === "export_controlled" ||
      flag === "terms_unknown",
  );
  if (hasEscalating) {
    return {
      rule: "legal_compliance",
      outcome: "require_approval",
      detail: `Legal flags require human review: ${describeLegalFlags(ctx.flags)}.`,
    };
  }

  return {
    rule: "legal_compliance",
    outcome: "allow",
    detail: `Legal flags acceptable: ${describeLegalFlags(ctx.flags)}.`,
  };
}

export function evaluateConnectorScope(
  ctx?: ConnectorScopeContext,
): RuleDecision | undefined {
  if (ctx == null) {
    return undefined;
  }

  const scope = ctx.scope?.trim();
  if (scope == null || scope.length === 0) {
    return {
      rule: "connector_scope",
      outcome: "require_approval",
      detail: "Connector scope missing; escalate for consent.",
    };
  }

  if ((HARD_DENY_SCOPES as readonly string[]).includes(scope)) {
    return {
      rule: "connector_scope",
      outcome: "deny",
      detail: `Connector scope ${scope} prohibited by policy.`,
    };
  }

  if ((AUTO_APPROVE_SCOPES as readonly string[]).includes(scope)) {
    return {
      rule: "connector_scope",
      outcome: "allow",
      detail: `Connector scope ${scope} already granted.`,
    };
  }

  return {
    rule: "connector_scope",
    outcome: "require_approval",
    detail: `Consent required before activating connector scope ${scope}.`,
  };
}

// ---------------------------------------------------------------------------
// Overall decision
// ---------------------------------------------------------------------------

export function overallDecision(rules: readonly RuleDecision[]): Decision {
  if (rules.some((r) => r.outcome === "deny")) {
    return "deny";
  }
  if (rules.some((r) => r.outcome === "require_approval")) {
    return "require_approval";
  }
  return "allow";
}

// ---------------------------------------------------------------------------
// Combined evaluation
// ---------------------------------------------------------------------------

export function evaluatePolicy(request: PolicyCheckRequest): PolicyDecision {
  const spendDecision = evaluateSpend(request.spend ?? undefined);
  const piiDecision = evaluatePii(request.pii ?? undefined);
  const legalDecision = evaluateLegal(request.legal ?? undefined);
  const connectorDecision = evaluateConnectorScope(
    request.connector ?? undefined,
  );

  const rules: RuleDecision[] = [spendDecision, piiDecision, legalDecision];
  if (connectorDecision != null) {
    rules.push(connectorDecision);
  }

  const decision = overallDecision(rules);

  return { decision, rules };
}
