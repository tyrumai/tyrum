import { encryptToken } from "./token-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes config partials before persisting:
 * - Encrypts plaintext `remote.tokenRef` values.
 */
export function normalizeConfigPartialForSave(
  partial: unknown,
): Record<string, unknown> {
  if (!isRecord(partial)) return {};

  const normalized: Record<string, unknown> = { ...partial };
  const remote = normalized["remote"];
  if (!isRecord(remote)) return normalized;

  const normalizedRemote: Record<string, unknown> = { ...remote };
  const tokenRef = normalizedRemote["tokenRef"];
  if (typeof tokenRef === "string" && tokenRef.length > 0) {
    normalizedRemote["tokenRef"] = encryptToken(tokenRef);
  }

  normalized["remote"] = normalizedRemote;
  return normalized;
}
