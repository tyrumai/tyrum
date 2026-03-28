import { formatSharedMessage, getDocumentLocale } from "../i18n/messages.js";

/**
 * Maps WebSocket disconnect codes and raw reason strings to user-friendly
 * messages.
 */

/** Well-known gateway close codes and their user-facing descriptions. */
const USER_MESSAGES_BY_CODE: Record<number, string> = {
  4001: "Authentication failed. Please check your credentials and try again.",
  4002: "Connection timed out during handshake. Please try again.",
  4003: "Connection rejected due to a protocol error. Please try reconnecting.",
  4004: "Your conversation has expired. Please reconnect.",
  4005: "Client version mismatch. Please refresh or update the application.",
  4006: "Device identity mismatch. Please reconnect.",
  4007: "Authentication proof was rejected. Please try again.",
  4008: "Token scope mismatch. Please check your credentials.",
};

/** Keyword patterns in the raw reason string, checked when the code is not in the map. */
const REASON_KEYWORD_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\bunauthorized\b/i,
    message: "Authentication failed. Please check your credentials and try again.",
  },
  { pattern: /\btimeout\b/i, message: "Connection timed out. Please try again." },
  { pattern: /\bexpired?\b/i, message: "Your conversation has expired. Please reconnect." },
  { pattern: /\binvalid.?token\b/i, message: "Invalid token. Please check your credentials." },
];

const GENERIC_MESSAGE = "Connection failed. Please try again.";

export function formatDisconnectMessage(code: number, reason: string): string {
  const trimmedReason = reason.trim();
  const locale = getDocumentLocale();

  const byCode = USER_MESSAGES_BY_CODE[code];
  if (byCode) {
    return formatSharedMessage(byCode, undefined, locale);
  }

  for (const { pattern, message } of REASON_KEYWORD_MESSAGES) {
    if (pattern.test(trimmedReason)) {
      return formatSharedMessage(message, undefined, locale);
    }
  }

  return formatSharedMessage(GENERIC_MESSAGE, undefined, locale);
}
