import { describe, expect, it } from "vitest";
import {
  currencyMinorUnits,
  evaluateConnectorScope,
  evaluateLegal,
  evaluatePii,
  evaluatePolicy,
  evaluateSpend,
  formatMoney,
  overallDecision,
} from "@tyrum/runtime-policy";

describe("runtime-policy engine", () => {
  it("handles currency minor units and money formatting", () => {
    expect(currencyMinorUnits("JPY")).toBe(0);
    expect(currencyMinorUnits("BHD")).toBe(3);
    expect(currencyMinorUnits("eur")).toBe(2);
    expect(formatMoney(1_234, "JPY")).toBe("JPY 1234");
    expect(formatMoney(12_345, "BHD")).toBe("BHD 12.345");
    expect(formatMoney(12_345, "EUR")).toBe("EUR 123.45");
  });

  it("evaluates spend context across missing, approval, deny, and allow cases", () => {
    expect(evaluateSpend().outcome).toBe("require_approval");
    expect(
      evaluateSpend({ amount_minor_units: 60_000, currency: "EUR", user_limit_minor_units: 90_000 })
        .outcome,
    ).toBe("deny");
    expect(
      evaluateSpend({ amount_minor_units: 15_000, currency: "EUR", user_limit_minor_units: 12_000 })
        .outcome,
    ).toBe("require_approval");
    expect(evaluateSpend({ amount_minor_units: 8_000, currency: "EUR" }).outcome).toBe("allow");
  });

  it("evaluates pii context across missing, empty, approval, deny, and allow cases", () => {
    expect(evaluatePii().outcome).toBe("require_approval");
    expect(evaluatePii({ categories: [] }).outcome).toBe("allow");
    expect(evaluatePii({ categories: ["basic_contact"] }).outcome).toBe("allow");
    expect(evaluatePii({ categories: ["financial"] }).outcome).toBe("require_approval");
    expect(evaluatePii({ categories: ["government_id"] }).outcome).toBe("deny");
  });

  it("evaluates legal context across missing, empty, approval, deny, and allow cases", () => {
    expect(evaluateLegal().outcome).toBe("require_approval");
    expect(evaluateLegal({ flags: [] }).outcome).toBe("allow");
    expect(evaluateLegal({ flags: ["terms_unknown"] }).outcome).toBe("require_approval");
    expect(evaluateLegal({ flags: ["prohibited_content"] }).outcome).toBe("deny");
    expect(evaluateLegal({ flags: ["copyright_ok"] }).outcome).toBe("allow");
  });

  it("evaluates connector scopes across undefined, blank, allow, approval, and deny cases", () => {
    expect(evaluateConnectorScope()).toBeUndefined();
    expect(evaluateConnectorScope({ scope: " " })?.outcome).toBe("require_approval");
    expect(evaluateConnectorScope({ scope: "mcp://calendar" })?.outcome).toBe("allow");
    expect(evaluateConnectorScope({ scope: "mcp://analytics" })?.outcome).toBe("require_approval");
    expect(evaluateConnectorScope({ scope: "mcp://admin" })?.outcome).toBe("deny");
  });

  it("applies overall decision precedence", () => {
    expect(overallDecision([{ outcome: "allow" } as never])).toBe("allow");
    expect(
      overallDecision([{ outcome: "allow" } as never, { outcome: "require_approval" } as never]),
    ).toBe("require_approval");
    expect(overallDecision([{ outcome: "deny" } as never, { outcome: "allow" } as never])).toBe(
      "deny",
    );
  });

  it("aggregates policy decisions using the most restrictive outcome", () => {
    expect(
      evaluatePolicy({
        spend: { amount_minor_units: 1_000, currency: "EUR" },
        pii: { categories: ["basic_contact"] },
        legal: { flags: [] },
      }).decision,
    ).toBe("allow");

    expect(
      evaluatePolicy({
        spend: { amount_minor_units: 1_000, currency: "EUR" },
        pii: { categories: ["basic_contact"] },
        legal: { flags: [] },
        connector: { scope: "mcp://analytics" },
      }).decision,
    ).toBe("require_approval");

    expect(
      evaluatePolicy({
        spend: { amount_minor_units: 1_000, currency: "EUR" },
        pii: { categories: ["biometric"] },
        legal: { flags: [] },
      }).decision,
    ).toBe("deny");
  });
});
