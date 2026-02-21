/**
 * PolicyBundleManager — merges multiple PolicyBundles by precedence
 * and evaluates domains against the merged rule set.
 *
 * Precedence order: deployment > agent > playbook.
 * Within the same precedence, rules are ordered by priority (lower = higher priority).
 * Action severity: deny > require_approval > allow.
 */

import type { PolicyRule } from "@tyrum/schemas";
import type { PolicyOverrideRow } from "./override-dal.js";
import { matchesWildcard } from "./wildcard.js";

export interface PolicyBundleConfig {
  rules: PolicyRule[];
  precedence: "deployment" | "agent" | "playbook";
  version?: string;
  metadata?: unknown;
}

export interface PolicyEvalResult {
  action: "allow" | "deny" | "require_approval";
  detail: string;
  rule?: PolicyRule;
  /** IDs of policy overrides that converted require_approval → allow. */
  applied_override_ids?: string[];
}

/** Context for override matching (tool_id + match_target). */
export interface OverrideContext {
  tool_id: string;
  match_target: string;
}

export class PolicyBundleManager {
  private bundles: PolicyBundleConfig[] = [];

  /** Add a bundle at a given precedence level. */
  addBundle(bundle: PolicyBundleConfig): void {
    this.bundles.push(bundle);
    this.bundles.sort(
      (a, b) => precedenceOrder(a.precedence) - precedenceOrder(b.precedence),
    );
  }

  /**
   * Get merged rules in precedence order.
   *
   * Higher-precedence bundles override lower ones: for each unique
   * (domain, conditions) pair, only the first rule encountered wins.
   * Within a bundle, rules are ordered by their `priority` field (ascending).
   */
  getMergedRules(): PolicyRule[] {
    const merged: PolicyRule[] = [];
    const seen = new Set<string>();

    for (const bundle of this.bundles) {
      const sorted = [...bundle.rules].sort((a, b) => a.priority - b.priority);
      for (const rule of sorted) {
        const key = `${rule.domain}:${JSON.stringify(rule.conditions ?? null)}`;
        if (!seen.has(key)) {
          merged.push(rule);
          seen.add(key);
        }
      }
    }
    return merged;
  }

  /**
   * Evaluate a domain against the merged rules.
   *
   * When `context` is provided, only rules whose `conditions` match the
   * context are considered. A rule matches when every key in its conditions
   * object equals the corresponding key in the context (shallow equality).
   * Rules with no conditions always match.
   *
   * When `overrides` and `overrideContext` are provided and the base result
   * is `require_approval`, matching active overrides convert it to `allow`.
   */
  evaluate(
    domain: string,
    context?: Record<string, unknown>,
    opts?: {
      overrides?: PolicyOverrideRow[];
      overrideContext?: OverrideContext;
    },
  ): PolicyEvalResult {
    const allRules = this.getMergedRules().filter((r) => r.domain === domain);
    const rules = allRules.filter((r) => matchesConditions(r.conditions, context));

    if (rules.length === 0) {
      return {
        action: "allow",
        detail: `No policy rules for domain '${domain}'`,
      };
    }

    // deny > require_approval > allow (overrides cannot relax deny)
    const denyRule = rules.find((r) => r.action === "deny");
    if (denyRule) {
      return {
        action: "deny",
        detail: denyRule.description ?? `Denied by policy rule for '${domain}'`,
        rule: denyRule,
      };
    }

    const approvalRule = rules.find((r) => r.action === "require_approval");
    if (approvalRule) {
      // Check for matching active policy overrides
      if (opts?.overrides && opts.overrideContext) {
        const matching = opts.overrides.filter(
          (o) =>
            o.status === "active" &&
            o.tool_id === opts.overrideContext!.tool_id &&
            matchesWildcard(o.pattern, opts.overrideContext!.match_target),
        );
        if (matching.length > 0) {
          return {
            action: "allow",
            detail: `Allowed by policy override(s) for '${domain}'`,
            rule: approvalRule,
            applied_override_ids: matching.map((o) => o.policy_override_id),
          };
        }
      }

      return {
        action: "require_approval",
        detail:
          approvalRule.description ?? `Approval required for '${domain}'`,
        rule: approvalRule,
      };
    }

    return {
      action: "allow",
      detail:
        rules[0]?.description ?? `Allowed by policy for '${domain}'`,
      rule: rules[0],
    };
  }

  /** Serialize the current bundle state for snapshotting. */
  toJSON(): PolicyBundleConfig[] {
    return [...this.bundles];
  }

  /** Get all bundles. */
  getBundles(): readonly PolicyBundleConfig[] {
    return this.bundles;
  }

  /** Clear all bundles. */
  clear(): void {
    this.bundles = [];
  }
}

/**
 * Check whether a rule's conditions match the provided context.
 *
 * - No conditions (undefined/null) → always matches.
 * - Empty object → always matches.
 * - Otherwise, every key in conditions must exist in context with
 *   strict equality (===). This is a simple, predictable matcher
 *   that avoids regex or deep comparison.
 */
function matchesConditions(
  conditions: unknown,
  context?: Record<string, unknown>,
): boolean {
  if (conditions == null) return true;
  if (typeof conditions !== "object" || Array.isArray(conditions)) return true;

  const cond = conditions as Record<string, unknown>;
  const keys = Object.keys(cond);
  if (keys.length === 0) return true;
  if (!context) return false;

  return keys.every((k) => context[k] === cond[k]);
}

function precedenceOrder(p: string): number {
  switch (p) {
    case "deployment":
      return 0;
    case "agent":
      return 1;
    case "playbook":
      return 2;
    default:
      return 3;
  }
}
