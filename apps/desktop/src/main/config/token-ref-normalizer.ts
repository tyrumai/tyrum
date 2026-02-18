import { encryptToken } from "./token-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes config partials before persisting:
 * - Encrypts plaintext `remote.tokenRef` and `embedded.tokenRef` values.
 */
export function normalizeConfigPartialForSave(
  partial: unknown,
): Record<string, unknown> {
  if (!isRecord(partial)) return {};

  const normalized: Record<string, unknown> = { ...partial };

  for (const sectionKey of ["remote", "embedded"] as const) {
    const section = normalized[sectionKey];
    if (!isRecord(section)) continue;

    const normalizedSection: Record<string, unknown> = { ...section };
    const tokenRef = normalizedSection["tokenRef"];
    if (typeof tokenRef === "string" && tokenRef.length > 0) {
      normalizedSection["tokenRef"] = encryptToken(tokenRef);
    }

    normalized[sectionKey] = normalizedSection;
  }

  return normalized;
}
