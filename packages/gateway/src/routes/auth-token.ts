import { Hono } from "hono";
import {
  AuthTokenCreatedBy,
  AuthTokenIssueResponse,
  AuthTokenListItem,
  AuthTokenListResponse,
  AuthTokenRevokeRequest,
  AuthTokenRevokeResponse,
  TenantAuthTokenIssueRequest,
} from "@tyrum/schemas";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { requireAuthClaims, requireTenantId } from "../modules/auth/claims.js";

export interface AuthTokenRouteDeps {
  authTokens: AuthTokenService;
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

export function createAuthTokenRoutes(deps: AuthTokenRouteDeps): Hono {
  const app = new Hono();

  app.get("/auth/tokens", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    if (claims.role !== "admin") {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

    const rows = await deps.authTokens.listTenantTokens(tenantId);
    const tokens = rows.map((row) =>
      AuthTokenListItem.parse({
        token_id: row.token_id,
        tenant_id: row.tenant_id,
        role: row.role,
        device_id: row.device_id,
        scopes: JSON.parse(row.scopes_json) as unknown,
        issued_at: row.issued_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        created_at: row.created_at,
        created_by: parseCreatedBy(row.created_by_json),
      }),
    );
    return c.json(AuthTokenListResponse.parse({ tokens }));
  });

  app.post("/auth/tokens/issue", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    if (claims.role !== "admin") {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

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
        role: issued.row.role,
        device_id: issued.row.device_id ?? undefined,
        scopes: JSON.parse(issued.row.scopes_json) as unknown,
        issued_at: issued.row.issued_at,
        expires_at: issued.row.expires_at ?? undefined,
      }),
      201,
    );
  });

  app.post("/auth/tokens/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    const claims = requireAuthClaims(c);
    if (claims.role !== "admin") {
      return c.json({ error: "forbidden", message: "admin token required" }, 403);
    }

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
