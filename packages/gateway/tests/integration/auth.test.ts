import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
    let adminToken: string;

    beforeEach(async () => {
      const tokenStore = new TokenStore(tempDir);
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

    it("rejects /memory/facts without token", async () => {
      const res = await app.request("/memory/facts");
      expect(res.status).toBe(401);
    });

    it("allows /memory/facts with valid token", async () => {
      const res = await app.request("/memory/facts", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects /memory/facts with invalid token", async () => {
      const res = await app.request("/memory/facts", {
        headers: { Authorization: "Bearer invalid" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("localhost bind (auth still enforced)", () => {
    let app: Hono;
    let adminToken: string;
    let spaDistDir: string;

    beforeEach(async () => {
      const tokenStore = new TokenStore(tempDir);
      adminToken = await tokenStore.initialize();
      spaDistDir = await mkdtemp(join(tmpdir(), "tyrum-spa-auth-"));
      await mkdir(join(spaDistDir, "assets"), { recursive: true });
      await writeFile(join(spaDistDir, "index.html"), "<!doctype html><html><body>SPA</body></html>");
      const result = await createTestApp({ tokenStore, isLocalOnly: true, spaDistDir });
      app = result.app;
    });

    afterEach(async () => {
      await rm(spaDistDir, { recursive: true, force: true });
    });

    it("allows /healthz without token", async () => {
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; is_exposed: boolean };
      expect(body.status).toBe("ok");
      expect(body.is_exposed).toBe(false);
    });

    it("rejects /memory/facts without token", async () => {
      const res = await app.request("/memory/facts");
      expect(res.status).toBe(401);
    });

    it("allows /memory/facts with valid token", async () => {
      const res = await app.request("/memory/facts", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it("bootstraps web auth cookie via /app/auth and grants /app access", async () => {
      const bootstrapRes = await app.request(
        `/app/auth?token=${encodeURIComponent(adminToken)}&next=%2Fapp`,
      );
      expect(bootstrapRes.status).toBe(302);
      const location = bootstrapRes.headers.get("location");
      expect(location).toBeTruthy();
      const redirectUrl = new URL(location ?? "/app", "http://localhost");
      expect(redirectUrl.pathname).toBe("/app");

      const setCookieHeader = bootstrapRes.headers.get("set-cookie");
      expect(setCookieHeader).toBeTruthy();
      const cookie = setCookieHeader?.split(";")[0] ?? "";

      const appRes = await app.request("/app/", {
        headers: { Cookie: cookie },
      });
      expect(appRes.status).toBe(200);
      const html = await appRes.text();
      expect(html).toContain("SPA");
    });
  });
});
