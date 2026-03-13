import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAuthTokenRoutes } from "../../src/routes/auth-token.js";

function createApp(overrides?: {
  tokenKind?: "admin" | "device";
  role?: "admin" | "client" | "node";
  scopes?: string[];
  tenantId?: string;
  listTenantTokens?: ReturnType<typeof vi.fn>;
  issueToken?: ReturnType<typeof vi.fn>;
  updateToken?: ReturnType<typeof vi.fn>;
  getTokenById?: ReturnType<typeof vi.fn>;
  revokeToken?: ReturnType<typeof vi.fn>;
  connectionManager?: { closeClientsForTokenId: ReturnType<typeof vi.fn> };
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: overrides?.tokenKind ?? "admin",
      token_id: "admin-token-id",
      tenant_id: overrides?.tenantId ?? "11111111-1111-4111-8111-111111111111",
      role: overrides?.role ?? "admin",
      scopes: overrides?.scopes ?? ["*"],
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
              display_name: "Client token",
              role: "client",
              device_id: "device-1",
              scopes_json: JSON.stringify(["operator.read"]),
              issued_at: "2026-03-06T12:00:00.000Z",
              expires_at: "2026-04-05T12:00:00.000Z",
              revoked_at: null,
              created_by_json: "{}",
              created_at: "2026-03-06T12:00:00.000Z",
              updated_at: "2026-03-06T12:00:00.000Z",
            },
          })),
        updateToken: overrides?.updateToken ?? vi.fn(async () => undefined),
        getTokenById: overrides?.getTokenById ?? vi.fn(async () => undefined),
        revokeToken: overrides?.revokeToken ?? vi.fn(async () => false),
      } as never,
      connectionManager: overrides?.connectionManager as never,
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
        display_name: "Admin token",
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
        updated_at: "2026-03-06T12:00:00.000Z",
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
      display_name: "Admin token",
      role: "admin",
      updated_at: "2026-03-06T12:00:00.000Z",
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
        display_name: "Admin token",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify(["*"]),
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-06T12:00:00.000Z",
        updated_at: "2026-03-06T12:00:00.000Z",
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

  it("allows scoped device tokens with operator.admin to list and issue tenant tokens", async () => {
    const listTenantTokens = vi.fn(async () => []);
    const issueToken = vi.fn(async () => ({
      token: "tyrum-token.v1.token-id.secret",
      row: {
        token_id: "token-id",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Client token",
        role: "client",
        device_id: "device-1",
        scopes_json: JSON.stringify(["operator.read"]),
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: "2026-04-05T12:00:00.000Z",
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-06T12:00:00.000Z",
        updated_at: "2026-03-06T12:00:00.000Z",
      },
    }));
    const app = createApp({
      tokenKind: "device",
      role: "client",
      scopes: ["operator.admin"],
      listTenantTokens,
      issueToken,
    });

    const listRes = await app.request("/auth/tokens");
    expect(listRes.status).toBe(200);
    expect(listTenantTokens).toHaveBeenCalledTimes(1);

    const issueRes = await app.request("/auth/tokens/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "client",
        scopes: ["operator.read"],
      }),
    });
    expect(issueRes.status).toBe(201);
    expect(issueToken).toHaveBeenCalledTimes(1);
  });

  it("updates tenant tokens in place and evicts matching websocket clients", async () => {
    const getTokenById = vi
      .fn()
      .mockResolvedValueOnce({
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Old token",
        role: "client",
        device_id: "device-1",
        scopes_json: JSON.stringify(["operator.read"]),
        secret_salt: "salt",
        secret_hash: "hash",
        kdf: "scrypt",
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-06T12:00:00.000Z",
        updated_at: "2026-03-06T12:00:00.000Z",
      })
      .mockResolvedValueOnce({
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Operator token",
        role: "client",
        device_id: "device-2",
        scopes_json: JSON.stringify(["operator.read", "operator.write"]),
        secret_salt: "salt",
        secret_hash: "hash",
        kdf: "scrypt",
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-06T12:00:00.000Z",
        updated_at: "2026-03-07T12:00:00.000Z",
      });
    const updateToken = vi.fn(async () => ({
      token_id: "token-1",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Operator token",
      role: "client",
      device_id: "device-2",
      scopes_json: JSON.stringify(["operator.read", "operator.write"]),
      secret_salt: "salt",
      secret_hash: "hash",
      kdf: "scrypt",
      issued_at: "2026-03-06T12:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      created_by_json: "{}",
      created_at: "2026-03-06T12:00:00.000Z",
      updated_at: "2026-03-07T12:00:00.000Z",
    }));
    const closeClientsForTokenId = vi.fn();
    const app = createApp({
      getTokenById,
      updateToken,
      connectionManager: { closeClientsForTokenId },
    });

    const res = await app.request("/auth/tokens/token-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: "Operator token",
        device_id: "device-2",
        scopes: ["operator.read", "operator.write"],
      }),
    });

    expect(res.status).toBe(200);
    expect(updateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: "token-1",
        displayName: "Operator token",
        deviceId: "device-2",
        scopes: ["operator.read", "operator.write"],
      }),
    );
    expect(closeClientsForTokenId).toHaveBeenCalledWith("token-1", { reason: "token updated" });
    expect(await res.json()).toEqual({
      token: expect.objectContaining({
        token_id: "token-1",
        display_name: "Operator token",
        device_id: "device-2",
        updated_at: "2026-03-07T12:00:00.000Z",
      }),
    });
  });

  it("allows metadata-only edits for client tokens without device bindings", async () => {
    const getTokenById = vi.fn(async () => ({
      token_id: "token-legacy",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Legacy client token",
      role: "client",
      device_id: null,
      scopes_json: JSON.stringify(["operator.read"]),
      secret_salt: "salt",
      secret_hash: "hash",
      kdf: "scrypt",
      issued_at: "2026-03-06T12:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      created_by_json: "{}",
      created_at: "2026-03-06T12:00:00.000Z",
      updated_at: "2026-03-06T12:00:00.000Z",
    }));
    const updateToken = vi.fn(async () => ({
      token_id: "token-legacy",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Renamed legacy token",
      role: "client",
      device_id: null,
      scopes_json: JSON.stringify(["operator.read"]),
      secret_salt: "salt",
      secret_hash: "hash",
      kdf: "scrypt",
      issued_at: "2026-03-06T12:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      created_by_json: "{}",
      created_at: "2026-03-06T12:00:00.000Z",
      updated_at: "2026-03-07T12:00:00.000Z",
    }));
    const app = createApp({ getTokenById, updateToken });

    const res = await app.request("/auth/tokens/token-legacy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: "Renamed legacy token",
      }),
    });

    expect(res.status).toBe(200);
    expect(updateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: "token-legacy",
        displayName: "Renamed legacy token",
        deviceId: undefined,
      }),
    );
    expect(await res.json()).toEqual({
      token: expect.objectContaining({
        token_id: "token-legacy",
        display_name: "Renamed legacy token",
        device_id: null,
      }),
    });
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

  it("evicts matching websocket clients when a tenant token is revoked", async () => {
    const getTokenById = vi.fn(async () => ({
      token_id: "token-1",
      tenant_id: "11111111-1111-4111-8111-111111111111",
    }));
    const revokeToken = vi.fn(async () => true);
    const closeClientsForTokenId = vi.fn();
    const app = createApp({
      getTokenById,
      revokeToken,
      connectionManager: { closeClientsForTokenId },
    });

    const res = await app.request("/auth/tokens/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_id: "token-1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true, token_id: "token-1" });
    expect(closeClientsForTokenId).toHaveBeenCalledWith("token-1", { reason: "token revoked" });
  });
});
