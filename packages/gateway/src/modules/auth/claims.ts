import { HTTPException } from "hono/http-exception";
import type { AuthTokenClaims } from "@tyrum/schemas";

export function requireAuthClaims(c: { get: (key: string) => unknown }): AuthTokenClaims {
  const raw = c.get("authClaims") as unknown;
  if (!raw || typeof raw !== "object") {
    throw new HTTPException(500, { message: "auth claims unavailable" });
  }
  return raw as AuthTokenClaims;
}

export function requireTenantId(c: { get: (key: string) => unknown }): string {
  const claims = requireAuthClaims(c);
  const tenantId = claims.tenant_id;
  if (!tenantId) {
    throw new HTTPException(403, { message: "tenant token required" });
  }
  return tenantId;
}
