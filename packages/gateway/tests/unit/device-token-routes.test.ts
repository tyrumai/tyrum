import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";
import { createDeviceTokenRoutes } from "../../src/routes/device-token.js";

describe("Device token routes", () => {
  let tempDir: string;
  let tokenStore: TokenStore;
  let adminToken: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-device-route-test-"));
    tokenStore = new TokenStore(tempDir);
    adminToken = await tokenStore.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore));
    app.route("/", createDeviceTokenRoutes({ tokenStore }));
    app.get("/status", (c) => c.json({ status: "ok" }));
    return app;
  }

  it("issues and revokes device tokens", async () => {
    const app = buildApp();

    const issueRes = await app.request("/auth/device-tokens/issue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device_id: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttl_seconds: 900,
      }),
    });
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as {
      token: string;
      token_id: string;
      device_id: string;
      role: string;
      scopes: string[];
    };
    expect(typeof issued.token).toBe("string");
    expect(issued.token_id).toBeTruthy();
    expect(issued.device_id).toBe("dev_client_1");
    expect(issued.role).toBe("client");
    expect(issued.scopes).toEqual(["operator.read"]);
    expect(
      tokenStore.authenticate(issued.token, {
        expectedRole: "client",
        expectedDeviceId: "dev_client_1",
      }),
    ).not.toBeNull();

    const preRevoke = await app.request("/status", {
      headers: { Authorization: `Bearer ${issued.token}` },
    });
    expect(preRevoke.status).toBe(200);

    const deviceIssueRes = await app.request("/auth/device-tokens/issue", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${issued.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device_id: "dev_client_2",
        role: "client",
        scopes: ["operator.read"],
        ttl_seconds: 900,
      }),
    });
    expect(deviceIssueRes.status).toBe(403);

    const deviceRevokeRes = await app.request("/auth/device-tokens/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${issued.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: issued.token }),
    });
    expect(deviceRevokeRes.status).toBe(403);

    const revokeRes = await app.request("/auth/device-tokens/revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: issued.token }),
    });
    expect(revokeRes.status).toBe(200);
    const revoked = (await revokeRes.json()) as { revoked: boolean; token_id?: string };
    expect(revoked.revoked).toBe(true);
    expect(revoked.token_id).toBe(issued.token_id);

    const postRevoke = await app.request("/status", {
      headers: { Authorization: `Bearer ${issued.token}` },
    });
    expect(postRevoke.status).toBe(401);
    expect(tokenStore.authenticate(issued.token)).toBeNull();
  });
});
