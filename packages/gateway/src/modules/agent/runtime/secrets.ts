export function looksLikeSecretText(text: string): boolean {
  if (!text) return false;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) return true;
  if (/\bsk-[A-Za-z0-9]{20,}\b/.test(text)) return true;
  return false;
}

export function redactSecretLikeText(text: string): string {
  let next = text;
  if (next.length === 0) return next;

  // Secret handle references ("secret:<handle_id>") should not be sent to providers.
  next = next.replace(/\bsecret:[A-Za-z0-9][A-Za-z0-9._-]*\b/g, "secret:[REDACTED]");
  // Common provider token formats.
  next = next.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[REDACTED]");
  next = next.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]");
  next = next.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]");
  next = next.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]");
  next = next.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED]");
  next = next.replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, "Bearer [REDACTED]");

  // Private key blocks can span multiple lines.
  next = next.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
    "[REDACTED_PRIVATE_KEY]",
  );

  // Generic key/value patterns.
  next = next.replace(
    /\b(password|passwd|pwd|api_key|apikey|token)\s*[:=]\s*\S{8,}/gi,
    "$1: [REDACTED]",
  );

  return next;
}
