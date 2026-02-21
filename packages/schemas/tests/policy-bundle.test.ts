import { describe, expect, it } from "vitest";
import {
  PolicyDomain,
  PolicyAction,
  PolicyPrecedence,
  PolicyRule,
  PolicyBundle,
} from "../src/index.js";

describe("PolicyDomain", () => {
  it("accepts known domains", () => {
    expect(PolicyDomain.parse("egress")).toBe("egress");
    expect(PolicyDomain.parse("pii")).toBe("pii");
    expect(PolicyDomain.parse("spend")).toBe("spend");
  });

  it("rejects unknown domain", () => {
    expect(() => PolicyDomain.parse("unknown")).toThrow();
  });
});

describe("PolicyAction", () => {
  it("accepts known actions", () => {
    expect(PolicyAction.parse("deny")).toBe("deny");
    expect(PolicyAction.parse("require_approval")).toBe("require_approval");
    expect(PolicyAction.parse("allow")).toBe("allow");
  });

  it("rejects unknown action", () => {
    expect(() => PolicyAction.parse("block")).toThrow();
  });
});

describe("PolicyPrecedence", () => {
  it("accepts known precedence levels", () => {
    expect(PolicyPrecedence.parse("deployment")).toBe("deployment");
    expect(PolicyPrecedence.parse("agent")).toBe("agent");
    expect(PolicyPrecedence.parse("playbook")).toBe("playbook");
  });
});

describe("PolicyRule", () => {
  const valid = {
    domain: "egress" as const,
    action: "deny" as const,
    priority: 10,
  };

  it("parses a valid rule", () => {
    const rule = PolicyRule.parse(valid);
    expect(rule.domain).toBe("egress");
    expect(rule.action).toBe("deny");
    expect(rule.priority).toBe(10);
  });

  it("accepts optional fields", () => {
    const rule = PolicyRule.parse({
      ...valid,
      conditions: { host: "*.evil.com" },
      description: "Block evil domains",
    });
    expect(rule.description).toBe("Block evil domains");
  });

  it("rejects missing priority", () => {
    const { priority: _, ...bad } = valid;
    expect(() => PolicyRule.parse(bad)).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() => PolicyRule.parse({ ...valid, extra: true })).toThrow();
  });
});

describe("PolicyBundle", () => {
  const validRule = {
    domain: "secrets" as const,
    action: "require_approval" as const,
    priority: 1,
  };

  const valid = {
    rules: [validRule],
    precedence: "deployment" as const,
  };

  it("parses a valid bundle", () => {
    const bundle = PolicyBundle.parse(valid);
    expect(bundle.rules).toHaveLength(1);
    expect(bundle.precedence).toBe("deployment");
  });

  it("accepts optional version and metadata", () => {
    const bundle = PolicyBundle.parse({
      ...valid,
      version: "1.0.0",
      metadata: { author: "admin" },
    });
    expect(bundle.version).toBe("1.0.0");
  });

  it("accepts empty rules array", () => {
    const bundle = PolicyBundle.parse({ ...valid, rules: [] });
    expect(bundle.rules).toEqual([]);
  });

  it("rejects extra fields (strict)", () => {
    expect(() => PolicyBundle.parse({ ...valid, extra: true })).toThrow();
  });
});
