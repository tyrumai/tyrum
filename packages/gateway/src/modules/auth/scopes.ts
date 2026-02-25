import { normalizeScopes, type AuthTokenClaims } from "./token-store.js";

export function hasAnyRequiredScope(
  claims: AuthTokenClaims,
  requiredScopes: readonly string[],
): boolean {
  if (requiredScopes.length === 0) return true;
  const scopes = normalizeScopes(claims.scopes);
  if (scopes.includes("*")) return true;
  return requiredScopes.some((scope) => scopes.includes(scope));
}
