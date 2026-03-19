/**
 * Policy engine tests — port of services/policy/src/lib.rs tests
 */

import { describe, expect, it } from "vitest";
import {
  evaluateSpend,
  evaluatePii,
  evaluateLegal,
  evaluateConnectorScope,
  formatMoney,
} from "@tyrum/runtime-policy";

describe("Policy engine", () => {
  describe("spend rule", () => {
    it("auto-approves within limit", () => {
      const decision = evaluateSpend({
        amount_minor_units: 8_000,
        currency: "EUR",
      });
      expect(decision.outcome).toBe("allow");
    });

    it("escalates above user limit", () => {
      const decision = evaluateSpend({
        amount_minor_units: 15_000,
        currency: "EUR",
        user_limit_minor_units: 12_000,
      });
      expect(decision.outcome).toBe("require_approval");
    });

    it("denies above hard limit", () => {
      const decision = evaluateSpend({
        amount_minor_units: 60_000,
        currency: "EUR",
        user_limit_minor_units: 80_000,
      });
      expect(decision.outcome).toBe("deny");
    });
  });

  describe("pii rule", () => {
    it("approves basic_contact", () => {
      const decision = evaluatePii({ categories: ["basic_contact"] });
      expect(decision.outcome).toBe("allow");
    });

    it("escalates financial", () => {
      const decision = evaluatePii({ categories: ["financial"] });
      expect(decision.outcome).toBe("require_approval");
    });

    it("denies biometric", () => {
      const decision = evaluatePii({ categories: ["biometric"] });
      expect(decision.outcome).toBe("deny");
    });
  });

  describe("legal rule", () => {
    it("approves no flags", () => {
      const decision = evaluateLegal({ flags: [] });
      expect(decision.outcome).toBe("allow");
    });

    it("escalates requires_review", () => {
      const decision = evaluateLegal({ flags: ["requires_review"] });
      expect(decision.outcome).toBe("require_approval");
    });

    it("denies prohibited_content", () => {
      const decision = evaluateLegal({ flags: ["prohibited_content"] });
      expect(decision.outcome).toBe("deny");
    });
  });

  describe("connector scope rule", () => {
    it("approves whitelisted scope", () => {
      const decision = evaluateConnectorScope({
        scope: "mcp://calendar",
      });
      expect(decision).toBeDefined();
      expect(decision!.outcome).toBe("allow");
    });

    it("escalates unknown scope", () => {
      const decision = evaluateConnectorScope({
        scope: "mcp://analytics",
      });
      expect(decision).toBeDefined();
      expect(decision!.outcome).toBe("require_approval");
    });

    it("denies blocked scope", () => {
      const decision = evaluateConnectorScope({
        scope: "mcp://secrets",
      });
      expect(decision).toBeDefined();
      expect(decision!.outcome).toBe("deny");
    });

    it("escalates when scope missing", () => {
      const decision = evaluateConnectorScope({});
      expect(decision).toBeDefined();
      expect(decision!.outcome).toBe("require_approval");
    });
  });

  describe("formatMoney", () => {
    it("respects zero-decimal currency (JPY)", () => {
      expect(formatMoney(1_234, "JPY")).toBe("JPY 1234");
    });

    it("respects three-decimal currency (BHD)", () => {
      expect(formatMoney(12_345, "BHD")).toBe("BHD 12.345");
    });
  });
});
