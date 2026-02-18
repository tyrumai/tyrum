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
    let adminToken: string;

    beforeEach(async () => {
      const tokenStore = new TokenStore(tempDir);
      adminToken = await tokenStore.initialize();
      const result = createTestApp({ tokenStore, isLocalOnly: false });
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

    beforeEach(async () => {
      const tokenStore = new TokenStore(tempDir);
      adminToken = await tokenStore.initialize();
      const result = createTestApp({ tokenStore, isLocalOnly: true });
      app = result.app;
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
  });
});
