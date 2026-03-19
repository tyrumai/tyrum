import { Hono } from "hono";
import {
  AuthTokenCreatedBy,
  AuthTokenIssueResponse,
  AuthTokenListItem,
  AuthTokenListResponse,
  AuthTokenRevokeRequest,
  AuthTokenRevokeResponse,
  AuthTokenUpdateRequest,
  AuthTokenUpdateResponse,
  TenantAuthTokenIssueRequest,
} from "@tyrum/contracts";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import type { AuthTokenListRow, AuthTokenRow } from "../modules/auth/auth-token-dal.js";
import { requireOperatorAdminAccess, requireTenantId } from "../modules/auth/claims.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

export interface AuthTokenRouteDeps {
  authTokens: AuthTokenService;
  connectionManager?: ConnectionManager;
}

function parseCreatedBy(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = AuthTokenCreatedBy.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch (err) {
    void err;
    return undefined;
  }
}

function closeClientsForToken(
  connectionManager: ConnectionManager | undefined,
  tokenId: string,
  reason: string,
): void {
  connectionManager?.closeClientsForTokenId(tokenId, { reason });
}

function toListItem(row: AuthTokenListRow | AuthTokenRow) {
  return AuthTokenListItem.parse({
    token_id: row.token_id,
    tenant_id: row.tenant_id,
    display_name: row.display_name,
    role: row.role,
    device_id: row.device_id,
    scopes: JSON.parse(row.scopes_json) as unknown,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: parseCreatedBy(row.created_by_json),
  });
}

export function createAuthTokenRoutes(deps: AuthTokenRouteDeps): Hono {
  const app = new Hono();
  const adminTokenRequired = { message: "admin token required" } as const;

  app.get("/auth/tokens", async (c) => {
    const tenantId = requireTenantId(c);
    requireOperatorAdminAccess(c, adminTokenRequired);

    const rows = await deps.authTokens.listTenantTokens(tenantId);
    const tokens = rows.map(toListItem);
    return c.json(AuthTokenListResponse.parse({ tokens }));
  });

  app.post("/auth/tokens/issue", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireOperatorAdminAccess(c, adminTokenRequired);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = TenantAuthTokenIssueRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const issued = await deps.authTokens.issueToken({
      tenantId,
      displayName: parsed.data.display_name,
      role: parsed.data.role,
      scopes: parsed.data.scopes,
      deviceId: parsed.data.device_id,
      ttlSeconds: parsed.data.ttl_seconds,
      createdByJson: JSON.stringify({
        kind: "http.auth_token.issue",
        issued_by: claims.token_id,
      }),
    });

    return c.json(
      AuthTokenIssueResponse.parse({
        token: issued.token,
        token_id: issued.row.token_id,
        tenant_id: issued.row.tenant_id,
        display_name: issued.row.display_name,
        role: issued.row.role,
        device_id: issued.row.device_id ?? undefined,
        scopes: JSON.parse(issued.row.scopes_json) as unknown,
        issued_at: issued.row.issued_at,
        updated_at: issued.row.updated_at,
        expires_at: issued.row.expires_at ?? undefined,
      }),
      201,
    );
  });

  app.patch("/auth/tokens/:tokenId", async (c) => {
    const tenantId = requireTenantId(c);
    requireOperatorAdminAccess(c, adminTokenRequired);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = AuthTokenUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const tokenId = c.req.param("tokenId")?.trim();
    if (!tokenId) {
      return c.json({ error: "invalid_request", message: "token id is required" }, 400);
    }

    const existing = await deps.authTokens.getTokenById(tokenId);
    if (!existing || existing.tenant_id !== tenantId) {
      return c.json({ error: "not_found", message: "token not found" }, 404);
    }
    if (existing.revoked_at) {
      return c.json({ error: "conflict", message: "revoked tokens cannot be edited" }, 409);
    }

    const updated = await deps.authTokens.updateToken({
      tokenId,
      displayName: parsed.data.display_name,
      role: parsed.data.role,
      deviceId: parsed.data.device_id,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expires_at,
    });
    if (!updated) {
      return c.json({ error: "conflict", message: "revoked tokens cannot be edited" }, 409);
    }

    closeClientsForToken(deps.connectionManager, updated.token_id, "token updated");
    return c.json(AuthTokenUpdateResponse.parse({ token: toListItem(updated) }), 200);
  });

  app.post("/auth/tokens/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    requireOperatorAdminAccess(c, adminTokenRequired);

    let body: unknown;
    try {
      body = (await c.req.json()) as unknown;
    } catch (err) {
      void err;
      return c.json({ error: "invalid_request", message: "invalid json" }, 400);
    }

    const parsed = AuthTokenRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const token = await deps.authTokens.getTokenById(parsed.data.token_id);
    if (!token || token.tenant_id !== tenantId) {
      return c.json(AuthTokenRevokeResponse.parse({ revoked: false }), 200);
    }

    const revoked = await deps.authTokens.revokeToken(parsed.data.token_id);
    if (revoked) {
      closeClientsForToken(deps.connectionManager, parsed.data.token_id, "token revoked");
    }
    return c.json(
      AuthTokenRevokeResponse.parse({
        revoked,
        token_id: revoked ? parsed.data.token_id : undefined,
      }),
      200,
    );
  });

  return app;
}
