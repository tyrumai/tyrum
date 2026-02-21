import type { ActionPrimitive, PolicyBundle, PolicyEffect, ProvenanceTag } from "@tyrum/schemas";

const SECRET_HANDLE_PREFIX = "secret:";

export type PolicyDecision = PolicyEffect;

export interface PolicyReason {
  domain: "tool" | "action" | "network" | "secrets" | "provenance";
  code: string;
  message: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reasons: PolicyReason[];
}

export interface PolicyProvenanceContext {
  sources: readonly ProvenanceTag[];
}

function rank(decision: PolicyDecision): number {
  switch (decision) {
    case "deny":
      return 2;
    case "require_approval":
      return 1;
    case "allow":
      return 0;
  }
}

function combine(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  return rank(b) > rank(a) ? b : a;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
  return re.test(value);
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  for (const p of patterns) {
    if (matchesGlob(p, value)) return true;
  }
  return false;
}

function evaluateRuleList(
  list: {
    allow: readonly string[];
    deny: readonly string[];
    require_approval: readonly string[];
    default: PolicyDecision;
  },
  value: string,
): PolicyDecision {
  if (matchesAny(list.deny, value)) return "deny";
  if (list.allow.length > 0 && !matchesAny(list.allow, value)) return "deny";
  if (matchesAny(list.require_approval, value)) return "require_approval";
  return list.default;
}

function normalizeHostname(hostname: string): string {
  const raw = hostname.trim().toLowerCase();
  // Strip brackets for IPv6 literals.
  if (raw.startsWith("[") && raw.endsWith("]")) return raw.slice(1, -1);
  return raw;
}

function hostMatches(pattern: string, hostname: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = normalizeHostname(hostname);
  if (!p) return false;
  if (p === "*") return true;

  // Convenience: treat "example.com" as suffix match for subdomains.
  if (!p.includes("*")) {
    if (h === p) return true;
    return h.endsWith(`.${p}`);
  }

  return matchesGlob(p, h);
}

function matchesAnyHost(patterns: readonly string[], hostname: string): boolean {
  for (const p of patterns) {
    if (hostMatches(p, hostname)) return true;
  }
  return false;
}

function evaluateNetworkHost(
  egress: {
    allow_hosts: readonly string[];
    deny_hosts: readonly string[];
    require_approval_hosts: readonly string[];
    default: PolicyDecision;
  },
  hostname: string,
): PolicyDecision {
  if (matchesAnyHost(egress.deny_hosts, hostname)) return "deny";
  if (matchesAnyHost(egress.allow_hosts, hostname)) return "allow";
  if (matchesAnyHost(egress.require_approval_hosts, hostname)) return "require_approval";
  return egress.default;
}

export function extractSecretHandleIds(value: unknown): string[] {
  const out = new Set<string>();

  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith(SECRET_HANDLE_PREFIX) && v.length > SECRET_HANDLE_PREFIX.length) {
        out.add(v.slice(SECRET_HANDLE_PREFIX.length));
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const item of Object.values(v as Record<string, unknown>)) {
        visit(item);
      }
    }
  };

  visit(value);
  return [...out];
}

function tryParseHostnameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

export function evaluateToolCall(
  policy: PolicyBundle,
  toolId: string,
  args: unknown,
  provenance?: PolicyProvenanceContext,
): PolicyEvaluation {
  const reasons: PolicyReason[] = [];
  let decision: PolicyDecision = "allow";

  const toolDecision = evaluateRuleList(policy.tools, toolId);
  if (toolDecision !== "allow") {
    reasons.push({
      domain: "tool",
      code: "tool_policy",
      message: `tool '${toolId}' is '${toolDecision}' by policy`,
    });
    decision = combine(decision, toolDecision);
  }

  if (toolId === "tool.http.fetch") {
    const parsed = args as Record<string, unknown> | null;
    const url = typeof parsed?.["url"] === "string" ? parsed["url"] : undefined;
    if (url) {
      const hostname = tryParseHostnameFromUrl(url);
      if (hostname) {
        const netDecision = evaluateNetworkHost(policy.network.egress, hostname);
        if (netDecision !== "allow") {
          reasons.push({
            domain: "network",
            code: "network_egress",
            message: `network egress to '${hostname}' is '${netDecision}' by policy`,
          });
        }
        decision = combine(decision, netDecision);
      }
    }
  }

  const secretIds = extractSecretHandleIds(args);
  if (secretIds.length > 0) {
    let secretsDecision: PolicyDecision = "allow";
    for (const id of secretIds) {
      const d = evaluateRuleList(policy.secrets.resolve, id);
      secretsDecision = combine(secretsDecision, d);
    }
    if (secretsDecision !== "allow") {
      reasons.push({
        domain: "secrets",
        code: "secret_resolution",
        message: `secret resolution is '${secretsDecision}' by policy`,
      });
    }
    decision = combine(decision, secretsDecision);
  }

  if (policy.provenance.rules.length > 0) {
    if (!provenance || provenance.sources.length === 0) {
      reasons.push({
        domain: "provenance",
        code: "missing_provenance",
        message: "provenance context missing; requiring approval conservatively",
      });
      decision = combine(decision, "require_approval");
    } else {
      for (const rule of policy.provenance.rules) {
        const matched = rule.sources.some((s) => provenance.sources.includes(s));
        if (!matched) continue;
        if (!rule.tools) continue;
        const d = evaluateRuleList(rule.tools, toolId);
        if (d !== "allow") {
          reasons.push({
            domain: "provenance",
            code: "provenance_tool_policy",
            message: `tool '${toolId}' is '${d}' due to provenance sources ${rule.sources.join(", ")}`,
          });
        }
        decision = combine(decision, d);
      }
    }
  }

  return { decision, reasons };
}

export function evaluateAction(
  policy: PolicyBundle,
  action: ActionPrimitive,
  provenance?: PolicyProvenanceContext,
): PolicyEvaluation {
  const reasons: PolicyReason[] = [];
  let decision: PolicyDecision = "allow";

  const actionDecision = evaluateRuleList(policy.actions, action.type);
  if (actionDecision !== "allow") {
    reasons.push({
      domain: "action",
      code: "action_policy",
      message: `action '${action.type}' is '${actionDecision}' by policy`,
    });
    decision = combine(decision, actionDecision);
  }

  // Network egress for known URL-carrying primitives (best-effort).
  if (action.type === "Http" || action.type === "Web") {
    const url = typeof action.args?.["url"] === "string" ? (action.args["url"] as string) : undefined;
    if (url) {
      const hostname = tryParseHostnameFromUrl(url);
      if (hostname) {
        const netDecision = evaluateNetworkHost(policy.network.egress, hostname);
        if (netDecision !== "allow") {
          reasons.push({
            domain: "network",
            code: "network_egress",
            message: `network egress to '${hostname}' is '${netDecision}' by policy`,
          });
        }
        decision = combine(decision, netDecision);
      }
    }
  }

  const secretIds = extractSecretHandleIds(action.args);
  if (secretIds.length > 0) {
    let secretsDecision: PolicyDecision = "allow";
    for (const id of secretIds) {
      const d = evaluateRuleList(policy.secrets.resolve, id);
      secretsDecision = combine(secretsDecision, d);
    }
    if (secretsDecision !== "allow") {
      reasons.push({
        domain: "secrets",
        code: "secret_resolution",
        message: `secret resolution is '${secretsDecision}' by policy`,
      });
    }
    decision = combine(decision, secretsDecision);
  }

  if (policy.provenance.rules.length > 0) {
    if (!provenance || provenance.sources.length === 0) {
      reasons.push({
        domain: "provenance",
        code: "missing_provenance",
        message: "provenance context missing; requiring approval conservatively",
      });
      decision = combine(decision, "require_approval");
    } else {
      for (const rule of policy.provenance.rules) {
        const matched = rule.sources.some((s) => provenance.sources.includes(s));
        if (!matched) continue;
        if (!rule.actions) continue;
        const d = evaluateRuleList(rule.actions, action.type);
        if (d !== "allow") {
          reasons.push({
            domain: "provenance",
            code: "provenance_action_policy",
            message: `action '${action.type}' is '${d}' due to provenance sources ${rule.sources.join(", ")}`,
          });
        }
        decision = combine(decision, d);
      }
    }
  }

  return { decision, reasons };
}
