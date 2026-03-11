import type { AuthTokenClaims } from "@tyrum/schemas";

export function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) return [];
  const normalized = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  return [...new Set(normalized)];
}

export function isBreakGlassAdmin(claims: Pick<AuthTokenClaims, "token_kind">): boolean {
  return claims.token_kind === "admin";
}

export function hasAnyRequiredScope(
  claims: AuthTokenClaims,
  requiredScopes: readonly string[],
): boolean {
  if (requiredScopes.length === 0) return true;
  if (isBreakGlassAdmin(claims)) return true;
  const scopes = normalizeScopes(claims.scopes);
  if (scopes.includes("*")) return true;
  return requiredScopes.some((scope) => scopes.includes(scope));
}
