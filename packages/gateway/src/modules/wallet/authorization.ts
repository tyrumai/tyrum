/**
 * Wallet authorization — port of services/tyrum-wallet/src/lib.rs
 *
 * Pure functions for spend authorization with configurable thresholds.
 */

import type {
  SpendAuthorizeRequest,
  SpendAuthorizeResponse,
  AuthorizationDecision,
  Thresholds,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_APPROVE_LIMIT_MINOR = 10_000;
const DEFAULT_HARD_DENY_LIMIT_MINOR = 50_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currencyMinorUnits(currency: string): number {
  const upper = currency.toUpperCase();
  const zeroDecimal = new Set([
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
  ]);
  const threeDecimal = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
  if (zeroDecimal.has(upper)) return 0;
  if (threeDecimal.has(upper)) return 3;
  return 2;
}

function formatMoney(amountMinor: number, currency: string): string {
  const decimals = currencyMinorUnits(currency);
  const divisor = Math.pow(10, decimals);
  const major = amountMinor / divisor;
  return `${currency.toUpperCase()} ${major.toFixed(decimals)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function defaultThresholds(): Thresholds {
  return {
    auto_approve_minor_units: DEFAULT_AUTO_APPROVE_LIMIT_MINOR,
    hard_deny_minor_units: DEFAULT_HARD_DENY_LIMIT_MINOR,
  };
}

export function authorizeWithThresholds(
  request: SpendAuthorizeRequest,
  thresholds: Thresholds,
): SpendAuthorizeResponse {
  const { amount_minor_units, currency, request_id } = request;

  let decision: AuthorizationDecision;
  let reason: string;

  if (amount_minor_units > thresholds.hard_deny_minor_units) {
    decision = "deny";
    reason = `Amount ${formatMoney(amount_minor_units, currency)} exceeds hard limit ${formatMoney(thresholds.hard_deny_minor_units, currency)}.`;
  } else if (amount_minor_units > thresholds.auto_approve_minor_units) {
    decision = "escalate";
    reason = `Amount ${formatMoney(amount_minor_units, currency)} exceeds auto-approval limit ${formatMoney(thresholds.auto_approve_minor_units, currency)}; escalate to human review.`;
  } else {
    decision = "approve";
    reason = `Amount ${formatMoney(amount_minor_units, currency)} within auto-approval limit ${formatMoney(thresholds.auto_approve_minor_units, currency)}.`;
  }

  return {
    request_id,
    decision,
    reason,
    limits: {
      auto_approve_minor_units: thresholds.auto_approve_minor_units,
      hard_deny_minor_units: thresholds.hard_deny_minor_units,
    },
  };
}
