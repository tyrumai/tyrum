import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";

describe("Auth integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-auth-integ-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("non-local bind (auth enforced)", () => {
    let app: Hono;
    let tokenStore: TokenStore;
    let adminToken: string;

    beforeEach(async () => {
      tokenStore = new TokenStore(tempDir);
      adminToken = await tokenStore.initialize();
      const result = await createTestApp({ tokenStore, isLocalOnly: false });
      app = result.app;
    });

    it("allows /healthz without token", async () => {
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; is_exposed: boolean };
      expect(body.status).toBe("ok");
      expect(body.is_exposed).toBe(true);
    });

    it("rejects /watchers without token", async () => {
      const res = await app.request("/watchers");
      expect(res.status).toBe(401);
    });

    it("rejects /status without token", async () => {
      const res = await app.request("/status");
      expect(res.status).toBe(401);
    });

    it("allows /watchers with valid token", async () => {
      const res = await app.request("/watchers", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("allows /status with valid token", async () => {
      const res = await app.request("/status", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects /watchers with invalid token", async () => {
      const res = await app.request("/watchers", {
        headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
    });

    it("authorizes /status with a client device token scoped to operator.read", async () => {
      const issued = await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 300,
      });

      const res = await app.request("/status", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(200);
    });

    it("forbids /status with a client device token missing operator.read", async () => {
      const issued = await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: [],
        ttlSeconds: 300,
      });

      const res = await app.request("/status", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("forbidden");
    });

    it("forbids POST /watchers with a read-only device token", async () => {
      const issued = await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 300,
      });

      const res = await app.request("/watchers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${issued.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_id: "plan-1",
          trigger_type: "periodic",
          trigger_config: { intervalMs: 1000 },
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("forbidden");
    });

    it("forbids /auth/pins with a non-admin device token", async () => {
      const issued = await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 300,
      });

      const res = await app.request("/auth/pins", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("forbidden");
    });
  });

  describe("localhost bind (auth still enforced)", () => {
    let app: Hono;
    let adminToken: string;

    beforeEach(async () => {
      const tokenStore = new TokenStore(tempDir);
      adminToken = await tokenStore.initialize();
      const result = await createTestApp({ tokenStore, isLocalOnly: true });
      app = result.app;
    });

    it("allows /healthz without token", async () => {
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; is_exposed: boolean };
      expect(body.status).toBe("ok");
      expect(body.is_exposed).toBe(false);
    });

    it("rejects /watchers without token", async () => {
      const res = await app.request("/watchers");
      expect(res.status).toBe(401);
    });

    it("rejects /status without token", async () => {
      const res = await app.request("/status");
      expect(res.status).toBe(401);
    });

    it("allows /watchers with valid token", async () => {
      const res = await app.request("/watchers", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("allows /status with valid token", async () => {
      const res = await app.request("/status", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("bootstraps auth cookie via /auth/session and supports logout", async () => {
      const loginRes = await app.request("/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      });
      expect(loginRes.status).toBe(204);

      const loginSetCookie = loginRes.headers.get("set-cookie");
      expect(loginSetCookie).toBeTruthy();
      const cookie = loginSetCookie?.split(";")[0] ?? "";

      const statusRes = await app.request("/status", {
        headers: { Cookie: cookie },
      });
      expect(statusRes.status).toBe(200);

      const logoutRes = await app.request("/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect(logoutRes.status).toBe(204);

      const logoutSetCookie = logoutRes.headers.get("set-cookie");
      expect(logoutSetCookie).toBeTruthy();
      const clearedCookie = logoutSetCookie?.split(";")[0] ?? "";

      const afterLogoutRes = await app.request("/status", {
        headers: { Cookie: clearedCookie },
      });
      expect(afterLogoutRes.status).toBe(401);
    });
  });
});
