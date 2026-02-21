import { describe, it, expect, afterEach } from "vitest";
import {
  PolicyBundleManager,
  type PolicyBundleConfig,
} from "../../src/modules/policy/bundle.js";
import type { PolicyRule } from "@tyrum/schemas";

function rule(
  domain: PolicyRule["domain"],
  action: PolicyRule["action"],
  priority: number,
  description?: string,
): PolicyRule {
  return { domain, action, priority, description };
}

describe("PolicyBundleManager", () => {
  let mgr: PolicyBundleManager;

  afterEach(() => {
    mgr.clear();
  });

  // -----------------------------------------------------------------------
  // addBundle / getMergedRules
  // -----------------------------------------------------------------------

  it("returns empty rules when no bundles added", () => {
    mgr = new PolicyBundleManager();
    expect(mgr.getMergedRules()).toEqual([]);
  });

  it("returns rules from a single bundle", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [rule("spend", "deny", 1, "block spend")],
      precedence: "agent",
    });
    const merged = mgr.getMergedRules();
    expect(merged).toHaveLength(1);
    expect(merged[0]!.domain).toBe("spend");
    expect(merged[0]!.action).toBe("deny");
  });

  it("sorts rules within a bundle by priority ascending", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        rule("spend", "allow", 10),
        rule("pii", "deny", 1),
        rule("legal", "require_approval", 5),
      ],
      precedence: "agent",
    });
    const merged = mgr.getMergedRules();
    expect(merged.map((r) => r.domain)).toEqual(["pii", "legal", "spend"]);
  });

  it("merges bundles in precedence order — deployment > agent > playbook", () => {
    mgr = new PolicyBundleManager();

    mgr.addBundle({
      rules: [rule("spend", "allow", 1, "playbook allow")],
      precedence: "playbook",
    });
    mgr.addBundle({
      rules: [rule("spend", "deny", 1, "deployment deny")],
      precedence: "deployment",
    });
    mgr.addBundle({
      rules: [rule("spend", "require_approval", 1, "agent escalate")],
      precedence: "agent",
    });

    const merged = mgr.getMergedRules();
    // deployment rule should win for the spend domain
    expect(merged).toHaveLength(1);
    expect(merged[0]!.action).toBe("deny");
    expect(merged[0]!.description).toBe("deployment deny");
  });

  it("deployment overrides agent overrides playbook for same domain+conditions", () => {
    mgr = new PolicyBundleManager();

    mgr.addBundle({
      rules: [rule("pii", "allow", 1)],
      precedence: "playbook",
    });
    mgr.addBundle({
      rules: [rule("pii", "require_approval", 1)],
      precedence: "agent",
    });

    // Without deployment, agent should win
    let merged = mgr.getMergedRules();
    expect(merged).toHaveLength(1);
    expect(merged[0]!.action).toBe("require_approval");

    // Now add deployment override
    mgr.addBundle({
      rules: [rule("pii", "deny", 1)],
      precedence: "deployment",
    });

    merged = mgr.getMergedRules();
    expect(merged).toHaveLength(1);
    expect(merged[0]!.action).toBe("deny");
  });

  it("allows different domains to have rules from different precedences", () => {
    mgr = new PolicyBundleManager();

    mgr.addBundle({
      rules: [rule("spend", "deny", 1)],
      precedence: "deployment",
    });
    mgr.addBundle({
      rules: [rule("pii", "require_approval", 1)],
      precedence: "agent",
    });
    mgr.addBundle({
      rules: [rule("legal", "allow", 1)],
      precedence: "playbook",
    });

    const merged = mgr.getMergedRules();
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.domain)).toContain("spend");
    expect(merged.map((r) => r.domain)).toContain("pii");
    expect(merged.map((r) => r.domain)).toContain("legal");
  });

  it("treats rules with different conditions as distinct entries", () => {
    mgr = new PolicyBundleManager();

    mgr.addBundle({
      rules: [
        { domain: "spend", action: "deny", priority: 1, conditions: { max: 100 } },
        { domain: "spend", action: "allow", priority: 2, conditions: { max: 500 } },
      ],
      precedence: "deployment",
    });

    const merged = mgr.getMergedRules();
    // Different conditions => both rules survive
    expect(merged).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // evaluate
  // -----------------------------------------------------------------------

  it("returns allow when no rules match the domain", () => {
    mgr = new PolicyBundleManager();
    const result = mgr.evaluate("spend");
    expect(result.action).toBe("allow");
    expect(result.detail).toContain("No policy rules");
  });

  it("returns deny when any matching rule denies", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        rule("spend", "allow", 2),
        rule("spend", "deny", 1, "hard deny"),
      ],
      precedence: "deployment",
    });
    const result = mgr.evaluate("spend");
    expect(result.action).toBe("deny");
    expect(result.detail).toBe("hard deny");
  });

  it("returns require_approval when no deny but approval required", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        rule("pii", "allow", 2),
        rule("pii", "require_approval", 1, "needs human review"),
      ],
      precedence: "agent",
    });
    const result = mgr.evaluate("pii");
    expect(result.action).toBe("require_approval");
    expect(result.detail).toBe("needs human review");
  });

  it("returns allow when all matching rules allow", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [rule("legal", "allow", 1, "all clear")],
      precedence: "playbook",
    });
    const result = mgr.evaluate("legal");
    expect(result.action).toBe("allow");
    expect(result.detail).toBe("all clear");
  });

  it("deny takes precedence over require_approval", () => {
    mgr = new PolicyBundleManager();
    // Use different conditions so both rules survive merge deduplication
    mgr.addBundle({
      rules: [
        { domain: "spend", action: "require_approval", priority: 1, conditions: { category: "payments" } },
        { domain: "spend", action: "deny", priority: 2, conditions: { region: "EU" } },
      ],
      precedence: "deployment",
    });
    // Pass context that satisfies both conditions
    const result = mgr.evaluate("spend", { category: "payments", region: "EU" });
    expect(result.action).toBe("deny");
  });

  // -----------------------------------------------------------------------
  // evaluate — context / condition matching
  // -----------------------------------------------------------------------

  it("filters rules by conditions when context is provided", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        { domain: "spend", action: "deny", priority: 1, conditions: { region: "EU" } },
        { domain: "spend", action: "allow", priority: 2, conditions: { region: "US" } },
      ],
      precedence: "deployment",
    });
    // Only the EU-deny rule should match
    const result = mgr.evaluate("spend", { region: "EU" });
    expect(result.action).toBe("deny");
  });

  it("skips conditional rules when no context is provided", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        { domain: "spend", action: "deny", priority: 1, conditions: { region: "EU" } },
      ],
      precedence: "deployment",
    });
    // No context → conditional rule doesn't match → default allow
    const result = mgr.evaluate("spend");
    expect(result.action).toBe("allow");
    expect(result.detail).toContain("No policy rules");
  });

  it("unconditional rules always match regardless of context", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [rule("spend", "deny", 1, "always deny")],
      precedence: "deployment",
    });
    const result = mgr.evaluate("spend", { region: "US" });
    expect(result.action).toBe("deny");
    expect(result.detail).toBe("always deny");
  });

  it("matches rule only when all condition keys are satisfied", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        { domain: "spend", action: "deny", priority: 1, conditions: { region: "EU", tier: "enterprise" } },
      ],
      precedence: "deployment",
    });
    // Only one key matches → rule should NOT match
    const partial = mgr.evaluate("spend", { region: "EU", tier: "free" });
    expect(partial.action).toBe("allow");

    // Both keys match → rule should match
    const full = mgr.evaluate("spend", { region: "EU", tier: "enterprise" });
    expect(full.action).toBe("deny");
  });

  it("mixes conditional and unconditional rules correctly", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [
        { domain: "spend", action: "deny", priority: 1, conditions: { region: "EU" } },
        rule("spend", "require_approval", 2, "default approval"),
      ],
      precedence: "deployment",
    });
    // Non-EU context: only unconditional rule matches → require_approval
    const nonEu = mgr.evaluate("spend", { region: "US" });
    expect(nonEu.action).toBe("require_approval");

    // EU context: both rules match, deny wins
    const eu = mgr.evaluate("spend", { region: "EU" });
    expect(eu.action).toBe("deny");
  });

  // -----------------------------------------------------------------------
  // toJSON / getBundles / clear
  // -----------------------------------------------------------------------

  it("toJSON returns a snapshot of the bundle state", () => {
    mgr = new PolicyBundleManager();
    const bundle: PolicyBundleConfig = {
      rules: [rule("spend", "deny", 1)],
      precedence: "deployment",
    };
    mgr.addBundle(bundle);

    const json = mgr.toJSON();
    expect(json).toHaveLength(1);
    expect(json[0]!.precedence).toBe("deployment");

    // Mutating returned array should not affect internal state
    json.pop();
    expect(mgr.getBundles()).toHaveLength(1);
  });

  it("clear removes all bundles", () => {
    mgr = new PolicyBundleManager();
    mgr.addBundle({
      rules: [rule("spend", "deny", 1)],
      precedence: "deployment",
    });
    expect(mgr.getBundles()).toHaveLength(1);

    mgr.clear();
    expect(mgr.getBundles()).toHaveLength(0);
    expect(mgr.getMergedRules()).toEqual([]);
  });
});
