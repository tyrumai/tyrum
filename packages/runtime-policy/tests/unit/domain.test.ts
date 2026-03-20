import { describe, expect, it } from "vitest";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "@tyrum/runtime-policy";

describe("runtime-policy domain helpers", () => {
  it("applies most restrictive decision precedence", () => {
    expect(mostRestrictiveDecision("allow", "allow")).toBe("allow");
    expect(mostRestrictiveDecision("allow", "require_approval")).toBe("require_approval");
    expect(mostRestrictiveDecision("require_approval", "deny")).toBe("deny");
  });

  it("normalizes missing domains with the fallback default", () => {
    expect(normalizeDomain(undefined, "require_approval")).toEqual({
      default: "require_approval",
      allow: [],
      require_approval: [],
      deny: [],
    });
  });

  it("uses deny, approval, then allow precedence when patterns overlap", () => {
    const domain = normalizeDomain(
      {
        default: "allow",
        allow: ["bash"],
        require_approval: ["ba*"],
        deny: ["bash"],
      },
      "require_approval",
    );

    expect(evaluateDomain(domain, "bash")).toBe("deny");
    expect(evaluateDomain({ ...domain, deny: [] }, "bash")).toBe("require_approval");
    expect(evaluateDomain({ ...domain, deny: [], require_approval: [] }, "bash")).toBe("allow");
    expect(evaluateDomain({ ...domain, deny: [], require_approval: [], allow: [] }, "other")).toBe(
      "allow",
    );
  });

  it("normalizes valid urls by stripping query strings and preserving protocol host and path", () => {
    expect(normalizeUrlForPolicy(" https://example.com/a/b?q=1#frag ")).toBe(
      "https://example.com/a/b",
    );
  });

  it("falls back cleanly for invalid strings and blank input", () => {
    expect(normalizeUrlForPolicy("host/path?x=1")).toBe("host/path");
    expect(normalizeUrlForPolicy("")).toBe("");
  });
});
