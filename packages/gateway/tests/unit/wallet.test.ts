/**
 * Wallet authorization tests — port of services/tyrum-wallet/src/lib.rs tests
 */

import { describe, expect, it } from "vitest";
import {
  authorizeWithThresholds,
  defaultThresholds,
} from "../../src/modules/wallet/authorization.js";
import type { Thresholds, SpendAuthorizeRequest } from "@tyrum/contracts";

describe("Wallet authorization", () => {
  const thresholds = defaultThresholds();

  function authorize(amount_minor_units: number, currency: string, t: Thresholds = thresholds) {
    return authorizeWithThresholds({ amount_minor_units, currency }, t);
  }

  it("returns the default thresholds", () => {
    expect(defaultThresholds()).toEqual({
      auto_approve_minor_units: 10_000,
      hard_deny_minor_units: 50_000,
    });
  });

  it("approves within limit", () => {
    const result = authorize(7_500, "EUR");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("within auto-approval limit");
  });

  it("approves at the auto-approval boundary", () => {
    const result = authorize(thresholds.auto_approve_minor_units, "EUR");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("within auto-approval limit");
  });

  it("escalates just above the auto-approval boundary", () => {
    const result = authorize(thresholds.auto_approve_minor_units + 1, "EUR");
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("exceeds auto-approval limit");
    expect(result.reason).toContain("escalate to human review");
  });

  it("escalates above auto", () => {
    const result = authorize(25_000, "EUR");
    expect(result.decision).toBe("escalate");
  });

  it("escalates at the hard-limit boundary", () => {
    const result = authorize(thresholds.hard_deny_minor_units, "EUR");
    expect(result.decision).toBe("escalate");
    expect(result.reason).toContain("exceeds auto-approval limit");
  });

  it("denies just above the hard-limit boundary", () => {
    const result = authorize(thresholds.hard_deny_minor_units + 1, "EUR");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("exceeds hard limit");
  });

  it("echoes thresholds back as response limits", () => {
    const result = authorize(7_500, "EUR");
    expect(result.limits).toEqual(thresholds);
  });

  it("formats zero-decimal currencies (JPY)", () => {
    const result = authorize(7_500, "jpy");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount JPY 7500");
    expect(result.reason).toContain("within auto-approval limit");
  });

  it("formats three-decimal currencies (KWD)", () => {
    const result = authorize(7_500, "kwd");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount KWD 7.500");
    expect(result.reason).toContain("within auto-approval limit");
  });

  it("formats unknown currencies with two decimals", () => {
    const result = authorize(7_500, "xyz");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount XYZ 75.00");
    expect(result.reason).toContain("within auto-approval limit");
  });

  it("handles empty currency strings", () => {
    const result = authorize(7_500, "");
    expect(result.decision).toBe("approve");
    expect(result.reason).toMatch(/Amount\s+75\.00 within auto-approval limit/);
  });

  it("approves zero amounts", () => {
    const result = authorize(0, "EUR");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount EUR 0.00 within auto-approval limit");
  });

  it("approves negative amounts (pre-validated inputs)", () => {
    const result = authorize(-1, "EUR");
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount EUR -0.01 within auto-approval limit");
  });

  it("denies non-finite amounts (pre-validated inputs)", () => {
    const result = authorize(Number.POSITIVE_INFINITY, "EUR");
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("exceeds hard limit");
  });

  it("supports custom thresholds", () => {
    const customThresholds: Thresholds = {
      auto_approve_minor_units: 100,
      hard_deny_minor_units: 200,
    };
    const result = authorize(150, "EUR", customThresholds);
    expect(result.decision).toBe("escalate");
    expect(result.limits).toEqual(customThresholds);
    expect(result.reason).toContain("exceeds auto-approval limit");
    expect(result.reason).toContain("escalate to human review");
    expect(result.reason).toContain("EUR 1.50");
    expect(result.reason).toContain("EUR 1.00");
  });

  it("throws when currency is missing (pre-validated inputs)", () => {
    expect(() => authorizeWithThresholds({ amount_minor_units: 1 } as any, thresholds)).toThrow();
  });

  it("formats NaN when amount_minor_units is missing (pre-validated inputs)", () => {
    const result = authorizeWithThresholds({ currency: "EUR" } as any, thresholds);
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("Amount EUR NaN within auto-approval limit");
  });

  it("authorize helper returns expected response", () => {
    const payload: SpendAuthorizeRequest = {
      request_id: "req-approve",
      card_id: "card_123",
      amount_minor_units: 7_500,
      currency: "eur",
      merchant: {
        name: "Example Shop",
      },
    };
    const response = authorizeWithThresholds(payload, thresholds);
    expect(response.request_id).toBe(payload.request_id);
    expect(response.decision).toBe("approve");
    expect(response.limits).toEqual(thresholds);
    expect(response.reason).toContain("within auto-approval limit");
    expect(response.reason).toContain("EUR 75.00");
    expect(response.reason).toMatch(/auto-approval limit EUR \d+\.\d{2}/);
  });
});
