import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createDeviceTokenRoutes } from "../../src/routes/device-token.js";

function createApp(options: {
  issueToken: ReturnType<typeof vi.fn>;
  tokenKind?: "admin" | "device";
  role?: "admin" | "client" | "node";
  scopes?: string[];
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: options.tokenKind ?? "admin",
      token_id: "auth-token-id",
      tenant_id: "tenant-1",
      role: options.role ?? "admin",
      scopes: options.scopes ?? ["*"],
    });
    await next();
  });
  app.route(
    "/",
    createDeviceTokenRoutes({
      authTokens: {
        issueToken: options.issueToken,
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

  it("allows scoped device tokens with operator.admin to issue device tokens", async () => {
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
    const app = createApp({
      issueToken,
      tokenKind: "device",
      role: "client",
      scopes: ["operator.admin"],
    });

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
    expect(issueToken).toHaveBeenCalledTimes(1);
  });
});
