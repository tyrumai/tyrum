import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";

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
    let requestUnauthenticated: typeof app.request;
    let tenantAdminToken: string;
    let authTokens: AuthTokenService;

    beforeEach(async () => {
      const result = await createTestApp({ tyrumHome: tempDir, isLocalOnly: false });
      app = result.app;
      requestUnauthenticated = result.requestUnauthenticated;
      tenantAdminToken = result.auth.tenantAdminToken;
      authTokens = result.auth.authTokens;
    });

    it("allows /healthz without token", async () => {
      const res = await requestUnauthenticated("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; is_exposed: boolean };
      expect(body.status).toBe("ok");
      expect(body.is_exposed).toBe(true);
    });

    it("rejects /watchers without token", async () => {
      const res = await requestUnauthenticated("/watchers");
      expect(res.status).toBe(401);
    });

    it("rejects /status without token", async () => {
      const res = await requestUnauthenticated("/status");
      expect(res.status).toBe(401);
    });

    it("allows /watchers with valid token", async () => {
      const res = await requestUnauthenticated("/watchers", {
        headers: { Authorization: `Bearer ${tenantAdminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("allows /status with valid token", async () => {
      const res = await requestUnauthenticated("/status", {
        headers: { Authorization: `Bearer ${tenantAdminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects /watchers with invalid token", async () => {
      const res = await requestUnauthenticated("/watchers", {
        headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
    });

    it("authorizes /status with a client device token scoped to operator.read", async () => {
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/status", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(200);
    });

    it("forbids /status with a client device token missing operator.read", async () => {
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: [],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/status", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("forbidden");
    });

    it("forbids POST /watchers with a read-only device token", async () => {
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/watchers", {
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
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const res = await requestUnauthenticated("/auth/pins", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("forbidden");
    });

    it("authorizes approval and pairing reads with an operator.read device token", async () => {
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const approvalsRes = await requestUnauthenticated("/approvals", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(approvalsRes.status).toBe(200);

      const pairingsRes = await requestUnauthenticated("/pairings", {
        headers: { Authorization: `Bearer ${issued.token}` },
      });
      expect(pairingsRes.status).toBe(200);
    });

    it("forbids approval and pairing mutations with a read-only device token", async () => {
      const issued = await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        scopes: ["operator.read"],
        deviceId: "dev_client_1",
        ttlSeconds: 300,
      });

      const approvalsRes = await requestUnauthenticated(
        "/approvals/00000000-0000-4000-8000-000000000001/respond",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${issued.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision: "approved" }),
        },
      );
      expect(approvalsRes.status).toBe(403);

      const pairingsRes = await requestUnauthenticated("/pairings/1/approve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${issued.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trust_level: "remote", capability_allowlist: [] }),
      });
      expect(pairingsRes.status).toBe(403);
    });
  });

  describe("localhost bind (auth still enforced)", () => {
    let app: Hono;
    let requestUnauthenticated: typeof app.request;
    let tenantAdminToken: string;

    beforeEach(async () => {
      const result = await createTestApp({ tyrumHome: tempDir, isLocalOnly: true });
      app = result.app;
      requestUnauthenticated = result.requestUnauthenticated;
      tenantAdminToken = result.auth.tenantAdminToken;
    });

    it("allows /healthz without token", async () => {
      const res = await requestUnauthenticated("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; is_exposed: boolean };
      expect(body.status).toBe("ok");
      expect(body.is_exposed).toBe(false);
    });

    it("rejects /watchers without token", async () => {
      const res = await requestUnauthenticated("/watchers");
      expect(res.status).toBe(401);
    });

    it("rejects /status without token", async () => {
      const res = await requestUnauthenticated("/status");
      expect(res.status).toBe(401);
    });

    it("allows /watchers with valid token", async () => {
      const res = await requestUnauthenticated("/watchers", {
        headers: { Authorization: `Bearer ${tenantAdminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("allows /status with valid token", async () => {
      const res = await requestUnauthenticated("/status", {
        headers: { Authorization: `Bearer ${tenantAdminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("bootstraps auth cookie via /auth/cookie and supports logout", async () => {
      const loginRes = await requestUnauthenticated("/auth/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tenantAdminToken }),
      });
      expect(loginRes.status).toBe(204);

      const loginSetCookie = loginRes.headers.get("set-cookie");
      expect(loginSetCookie).toBeTruthy();
      const cookie = loginSetCookie?.split(";")[0] ?? "";

      const statusRes = await requestUnauthenticated("/status", {
        headers: { Cookie: cookie },
      });
      expect(statusRes.status).toBe(200);

      const logoutRes = await requestUnauthenticated("/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect(logoutRes.status).toBe(204);

      const logoutSetCookie = logoutRes.headers.get("set-cookie");
      expect(logoutSetCookie).toBeTruthy();
      const clearedCookie = logoutSetCookie?.split(";")[0] ?? "";

      const afterLogoutRes = await requestUnauthenticated("/status", {
        headers: { Cookie: clearedCookie },
      });
      expect(afterLogoutRes.status).toBe(401);
    });

    it("accepts a provisioned opaque tenant admin token via /auth/cookie", async () => {
      const { container, requestUnauthenticated: requestWithProvisionedToken } =
        await createTestApp({
          tyrumHome: tempDir,
          isLocalOnly: true,
          provisionedTenantAdminToken: "opaque-admin-token",
        });
      try {
        const loginRes = await requestWithProvisionedToken("/auth/cookie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "opaque-admin-token" }),
        });
        expect(loginRes.status).toBe(204);

        const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";
        expect(cookie).toContain("tyrum_admin_token=");

        const statusRes = await requestWithProvisionedToken("/status", {
          headers: { Cookie: cookie },
        });
        expect(statusRes.status).toBe(200);
      } finally {
        await container.db.close();
      }
    });
  });
});
