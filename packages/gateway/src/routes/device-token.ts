/**
 * Device token routes (tenant-scoped; DB-backed).
 *
 * Backwards-compatible surface for issuing short-lived, device-bound tokens
 * used by operator tooling (TUI/Desktop) without relying on legacy TokenStore.
 */

import { Hono } from "hono";
import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
  MAX_DEVICE_TOKEN_TTL_SECONDS,
} from "@tyrum/schemas";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { requireOperatorAdminAccess, requireTenantId } from "../modules/auth/claims.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

export interface DeviceTokenRouteDeps {
  authTokens: AuthTokenService;
  connectionManager?: ConnectionManager;
}

export function createDeviceTokenRoutes(deps: DeviceTokenRouteDeps): Hono {
  const app = new Hono();
  const adminTokenRequired = { message: "admin token required" } as const;

  app.post("/auth/device-tokens/issue", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireOperatorAdminAccess(c, adminTokenRequired);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = DeviceTokenIssueRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const ttlSeconds = parsed.data.persistent
      ? undefined
      : (parsed.data.ttl_seconds ?? MAX_DEVICE_TOKEN_TTL_SECONDS);
    const issued = await deps.authTokens.issueToken({
      tenantId,
      role: parsed.data.role,
      scopes: parsed.data.scopes,
      deviceId: parsed.data.device_id,
      ttlSeconds,
      createdByJson: JSON.stringify({
        kind: "http.device_token.issue",
        issued_by: claims.token_id,
      }),
    });

    return c.json(
      DeviceTokenIssueResponse.parse({
        token_kind: "device",
        token: issued.token,
        token_id: issued.row.token_id,
        device_id: issued.row.device_id ?? parsed.data.device_id,
        role: issued.row.role,
        scopes: JSON.parse(issued.row.scopes_json) as unknown,
        issued_at: issued.row.issued_at,
        expires_at: issued.row.expires_at ?? null,
      }),
      201,
    );
  });

  app.post("/auth/device-tokens/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    requireOperatorAdminAccess(c, adminTokenRequired);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = DeviceTokenRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const tokenClaims = await deps.authTokens.authenticate(parsed.data.token).catch(() => null);
    if (!tokenClaims || tokenClaims.tenant_id !== tenantId) {
      return c.json(DeviceTokenRevokeResponse.parse({ revoked: false }), 200);
    }

    if (tokenClaims.role === "admin") {
      return c.json({ error: "invalid_request", message: "cannot revoke admin tokens here" }, 400);
    }

    const revoked = await deps.authTokens.revokeToken(tokenClaims.token_id);
    if (revoked) {
      deps.connectionManager?.closeClientsForTokenId(tokenClaims.token_id, {
        reason: "token revoked",
      });
    }
    return c.json(
      DeviceTokenRevokeResponse.parse({
        revoked,
        token_id: revoked ? tokenClaims.token_id : undefined,
      }),
      200,
    );
  });

  return app;
}
