import type { AuthTokenClaims } from "../modules/auth/token-store.js";

export type WsBroadcastRole = "client" | "node";
export type WsBroadcastAudience = {
  roles?: WsBroadcastRole[];
  required_scopes?: string[];
};

export function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) return [];
  const normalized = scopes
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return [...new Set(normalized)];
}

function hasAnyRequiredScope(claims: AuthTokenClaims, requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) return true;
  const scopes = normalizeScopes(claims.scopes);
  if (scopes.includes("*")) return true;
  return requiredScopes.some((scope) => scopes.includes(scope));
}

export function shouldDeliverToWsAudience(
  client: { role: string; auth_claims?: AuthTokenClaims },
  audience: WsBroadcastAudience | undefined,
): boolean {
  if (!audience) return true;

  const roles = audience.roles;
  if (roles && roles.length > 0 && !roles.includes(client.role as never)) {
    return false;
  }

  const required = audience.required_scopes;
  if (required && required.length > 0) {
    const claims = client.auth_claims;
    if (!claims) return false;
    if (claims.token_kind !== "admin" && !hasAnyRequiredScope(claims, required)) {
      return false;
    }
  }

  return true;
}

