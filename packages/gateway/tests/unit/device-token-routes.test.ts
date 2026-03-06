import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createDeviceTokenRoutes } from "../../src/routes/device-token.js";

function createApp(authTokens: { issueToken: ReturnType<typeof vi.fn> }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "admin-token-id",
      tenant_id: "tenant-1",
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route(
    "/",
    createDeviceTokenRoutes({
      authTokens: {
        issueToken: authTokens.issueToken,
        authenticate: vi.fn(),
        revokeToken: vi.fn(),
      },
    }),
  );
  return app;
}

describe("device token routes", () => {
  it("issues persistent device tokens with a null expires_at", async () => {
    const issueToken = vi.fn(async () => ({
      token: "tyrum-token.v1.token-id.secret",
      row: {
        token_id: "token-id",
        device_id: "device-1",
        role: "client",
        scopes_json: JSON.stringify(["operator.read"]),
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: null,
      },
    }));
    const app = createApp({ issueToken });

    const res = await app.request("/auth/device-tokens/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "device-1",
        role: "client",
        scopes: ["operator.read"],
        persistent: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { expires_at: string | null };
    expect(body.expires_at).toBeNull();
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        deviceId: "device-1",
        ttlSeconds: undefined,
      }),
    );
  });

  it("keeps the default ttl behavior when persistent is omitted", async () => {
    const issueToken = vi.fn(async () => ({
      token: "tyrum-token.v1.token-id.secret",
      row: {
        token_id: "token-id",
        device_id: "device-1",
        role: "client",
        scopes_json: JSON.stringify(["operator.read"]),
        issued_at: "2026-03-06T12:00:00.000Z",
        expires_at: "2026-04-05T12:00:00.000Z",
      },
    }));
    const app = createApp({ issueToken });

    const res = await app.request("/auth/device-tokens/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "device-1",
        role: "client",
        scopes: ["operator.read"],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { expires_at: string | null };
    expect(body.expires_at).toBe("2026-04-05T12:00:00.000Z");
    expect(issueToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ttlSeconds: 60 * 60 * 24 * 30,
      }),
    );
  });

  it("rejects issue requests that mix persistent and ttl_seconds", async () => {
    const issueToken = vi.fn();
    const app = createApp({ issueToken });

    const res = await app.request("/auth/device-tokens/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "device-1",
        role: "client",
        scopes: ["operator.read"],
        persistent: true,
        ttl_seconds: 60,
      }),
    });

    expect(res.status).toBe(400);
    expect(issueToken).not.toHaveBeenCalled();
  });
});
