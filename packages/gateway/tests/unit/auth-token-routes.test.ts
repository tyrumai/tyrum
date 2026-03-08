import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAuthTokenRoutes } from "../../src/routes/auth-token.js";

function createApp(overrides?: {
  role?: "admin" | "client" | "node";
  tenantId?: string;
  listTenantTokens?: ReturnType<typeof vi.fn>;
  issueToken?: ReturnType<typeof vi.fn>;
  getTokenById?: ReturnType<typeof vi.fn>;
  revokeToken?: ReturnType<typeof vi.fn>;
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "admin-token-id",
      tenant_id: overrides?.tenantId ?? "11111111-1111-4111-8111-111111111111",
      role: overrides?.role ?? "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route(
    "/",
    createAuthTokenRoutes({
      authTokens: {
        listTenantTokens: overrides?.listTenantTokens ?? vi.fn(async () => []),
        issueToken:
          overrides?.issueToken ??
          vi.fn(async () => ({
            token: "tyrum-token.v1.token-id.secret",
            row: {
              token_id: "token-id",
              tenant_id: "11111111-1111-4111-8111-111111111111",
              role: "client",
              device_id: "device-1",
              scopes_json: JSON.stringify(["operator.read"]),
              issued_at: "2026-03-06T12:00:00.000Z",
              expires_at: "2026-04-05T12:00:00.000Z",
            },
          })),
        getTokenById: overrides?.getTokenById ?? vi.fn(async () => undefined),
        revokeToken: overrides?.revokeToken ?? vi.fn(async () => false),
      } as never,
    }),
  );
  return app;
}

describe("auth token routes", () => {
  it("lists safe tenant token metadata without secrets", async () => {
    const listTenantTokens = vi.fn(async () => [
      {
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify(["*"]),
        secret_salt: "salt",
        secret_hash: "hash",
        kdf: "scrypt",
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: JSON.stringify({
          kind: "http.auth_token.issue",
          issued_by: "admin-token-id",
        }),
        created_at: "2026-03-06T12:00:00.000Z",
      },
    ]);
    const app = createApp({ listTenantTokens });

    const res = await app.request("/auth/tokens");

    expect(res.status).toBe(200);
    expect(listTenantTokens).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    const body = (await res.json()) as {
      tokens: Array<Record<string, unknown>>;
    };
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      token_id: "token-1",
      role: "admin",
      created_by: {
        kind: "http.auth_token.issue",
        issued_by: "admin-token-id",
      },
    });
    expect(body.tokens[0]).not.toHaveProperty("secret_hash");
    expect(body.tokens[0]).not.toHaveProperty("secret_salt");
  });

  it("issues tenant-scoped admin tokens", async () => {
    const issueToken = vi.fn(async () => ({
      token: "tyrum-token.v1.token-id.secret",
      row: {
        token_id: "token-id",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify(["*"]),
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
      },
    }));
    const app = createApp({ issueToken });

    const res = await app.request("/auth/tokens/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "admin",
        scopes: ["*"],
      }),
    });

    expect(res.status).toBe(201);
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "11111111-1111-4111-8111-111111111111",
        role: "admin",
        scopes: ["*"],
      }),
    );
  });

  it("returns revoked false when the token is outside the current tenant", async () => {
    const getTokenById = vi.fn(async () => ({
      token_id: "token-1",
      tenant_id: "22222222-2222-4222-8222-222222222222",
    }));
    const revokeToken = vi.fn(async () => true);
    const app = createApp({ getTokenById, revokeToken });

    const res = await app.request("/auth/tokens/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_id: "token-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: false });
    expect(revokeToken).not.toHaveBeenCalled();
  });
});
