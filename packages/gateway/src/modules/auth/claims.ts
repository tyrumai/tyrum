import { HTTPException } from "hono/http-exception";
import type { AuthTokenClaims } from "@tyrum/contracts";
import { hasAnyRequiredScope } from "./scopes.js";
import { requireTenantIdValue } from "../identity/scope.js";

function jsonForbiddenResponse(message: string): Response {
  return new Response(JSON.stringify({ error: "forbidden", message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

export function requireAuthClaims(c: { get: (key: string) => unknown }): AuthTokenClaims {
  const raw = c.get("authClaims") as unknown;
  if (!raw || typeof raw !== "object") {
    throw new HTTPException(500, { message: "auth claims unavailable" });
  }
  return raw as AuthTokenClaims;
}

export function requireTenantId(c: { get: (key: string) => unknown }): string {
  const claims = requireAuthClaims(c);
  try {
    return requireTenantIdValue(claims.tenant_id, "tenant token required");
  } catch {
    // Intentional: translate missing tenant scope into the route-layer HTTP authorization error.
    throw new HTTPException(403, { message: "tenant token required" });
  }
}

export function requireOperatorAdminAccess(
  c: { get: (key: string) => unknown },
  options?: { message?: string },
): AuthTokenClaims {
  const claims = requireAuthClaims(c);
  if (claims.role === "admin" || hasAnyRequiredScope(claims, ["operator.admin"])) {
    return claims;
  }
  throw new HTTPException(403, {
    res: jsonForbiddenResponse(options?.message ?? "operator admin access required"),
  });
}
