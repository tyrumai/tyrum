/**
 * Wallet authorization tests — port of services/tyrum-wallet/src/lib.rs tests
 */

import { describe, expect, it } from "vitest";
import {
  authorizeWithThresholds,
} from "../../src/modules/wallet/authorization.js";
import type { Thresholds, SpendAuthorizeRequest } from "@tyrum/schemas";

describe("Wallet authorization", () => {
  const thresholds: Thresholds = {
    auto_approve_minor_units: 10_000,
    hard_deny_minor_units: 50_000,
  };

  it("approves within limit", () => {
    const result = authorizeWithThresholds(
      {
        amount_minor_units: 7_500,
        currency: "EUR",
      },
      thresholds,
    );
    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("within auto-approval limit EUR 100.00");
  });

  it("escalates above auto", () => {
    const result = authorizeWithThresholds(
      {
        amount_minor_units: 25_000,
        currency: "EUR",
      },
      thresholds,
    );
    expect(result.decision).toBe("escalate");
  });

  it("denies above hard", () => {
    const result = authorizeWithThresholds(
      {
        amount_minor_units: 75_000,
        currency: "EUR",
      },
      thresholds,
    );
    expect(result.decision).toBe("deny");
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
    expect(response.decision).toBe("approve");
    expect(response.reason).toBe(
      "Amount EUR 75.00 within auto-approval limit EUR 100.00.",
    );
  });
});
