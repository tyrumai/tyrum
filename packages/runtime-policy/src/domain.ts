import type { Decision } from "@tyrum/contracts";
import { wildcardMatch } from "./wildcard.js";

export type PolicyDomainConfig = {
  default: Decision;
  allow: readonly string[];
  require_approval: readonly string[];
  deny: readonly string[];
};

export function mostRestrictiveDecision(a: Decision, b: Decision): Decision {
  if (a === "deny" || b === "deny") return "deny";
  if (a === "require_approval" || b === "require_approval") return "require_approval";
  return "allow";
}

export function normalizeDomain(
  value:
    | {
        default?: Decision;
        allow: string[];
        require_approval: string[];
        deny: string[];
      }
    | undefined,
  fallbackDefault: Decision,
): PolicyDomainConfig {
  if (!value) {
    return { default: fallbackDefault, allow: [], require_approval: [], deny: [] };
  }
  return {
    default: value.default ?? fallbackDefault,
    allow: value.allow ?? [],
    require_approval: value.require_approval ?? [],
    deny: value.deny ?? [],
  };
}

export function evaluateDomain(domain: PolicyDomainConfig, matchTarget: string): Decision {
  const target = matchTarget.trim();

  for (const pattern of domain.deny) {
    if (wildcardMatch(pattern, target)) return "deny";
  }
  for (const pattern of domain.require_approval) {
    if (wildcardMatch(pattern, target)) return "require_approval";
  }
  for (const pattern of domain.allow) {
    if (wildcardMatch(pattern, target)) return "allow";
  }

  return domain.default;
}

export function normalizeUrlForPolicy(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname || "/";
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    const queryIndex = trimmed.indexOf("?");
    return queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex);
  }
}
