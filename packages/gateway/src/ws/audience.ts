import type { AuthTokenClaims } from "@tyrum/contracts";
import { hasAnyRequiredScope } from "../app/modules/auth/scopes.js";

export type WsBroadcastRole = "client" | "node";
export type WsBroadcastAudience = {
  roles?: WsBroadcastRole[];
  required_scopes?: string[];
};

export const OPERATOR_WS_AUDIENCE = {
  roles: ["client"],
} as const satisfies WsBroadcastAudience;

export const APPROVAL_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.read", "operator.approvals"],
} as const satisfies WsBroadcastAudience;

export const APPROVAL_PROMPT_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.approvals"],
} as const satisfies WsBroadcastAudience;

export const APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.approvals", "operator.admin"],
} as const satisfies WsBroadcastAudience;

export const PAIRING_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.read", "operator.pairing"],
} as const satisfies WsBroadcastAudience;

export const POLICY_WS_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.admin"],
} as const satisfies WsBroadcastAudience;

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
