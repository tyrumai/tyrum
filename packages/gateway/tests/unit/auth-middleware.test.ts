import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";

describe("Auth middleware", () => {
  let tempDir: string;
  let tokenStore: TokenStore;
  let adminToken: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-auth-mw-test-"));
    tokenStore = new TokenStore(tempDir);
    adminToken = await tokenStore.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore));
    app.get("/healthz", (c) => c.json({ status: "ok" }));
    app.get("/app", (c) => c.json({ ok: true }));
    app.get("/app/settings", (c) => c.json({ ok: true }));
    app.get("/app/auth", (c) => c.json({ ok: true }));
    app.get("/providers/test/oauth/callback", (c) => c.json({ ok: true }));
    // These routes are intentionally *not* part of the /app subtree, but share a prefix.
    // Query-string token auth must not apply to them.
    app.get("/application", (c) => c.json({ ok: true }));
    app.get("/appdata", (c) => c.json({ ok: true }));
    app.get("/api/data", (c) => c.json({ data: "secret" }));
    app.post("/api/action", (c) => c.json({ done: true }));
    return app;
  }

  it("allows /healthz without token", async () => {
    const app = buildApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("allows OAuth callback without token", async () => {
    const app = buildApp();
    const res = await app.request("/providers/test/oauth/callback?state=s&code=c");
    expect(res.status).toBe(200);
  });

  it("rejects requests without token", async () => {
    const app = buildApp();
    const res = await app.request("/api/data");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects requests with wrong token", async () => {
    const app = buildApp();
    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("allows requests with correct token", async () => {
    const app = buildApp();
    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string };
    expect(body.data).toBe("secret");
  });

  it("allows requests with valid auth cookie", async () => {
    const app = buildApp();
    const res = await app.request("/api/data", {
      headers: { Cookie: `tyrum_admin_token=${encodeURIComponent(adminToken)}` },
    });
    expect(res.status).toBe(200);
  });

  it("allows /app/auth bootstrap with query token", async () => {
    const app = buildApp();
    const res = await app.request(
      `/app/auth?token=${encodeURIComponent(adminToken)}&next=%2Fapp`,
    );
    expect(res.status).toBe(200);
  });

  it("allows /app route with query token", async () => {
    const app = buildApp();
    const res = await app.request(`/app?token=${encodeURIComponent(adminToken)}`);
    expect(res.status).toBe(200);
  });

  it("allows /app subtree route with query token", async () => {
    const app = buildApp();
    const res = await app.request(`/app/settings?token=${encodeURIComponent(adminToken)}`);
    expect(res.status).toBe(200);
  });

  it("rejects non-app route even when query token is present", async () => {
    const app = buildApp();
    const res = await app.request(`/api/data?token=${encodeURIComponent(adminToken)}`);
    expect(res.status).toBe(401);
  });

  it("rejects prefix-collision route even when query token is present", async () => {
    const app = buildApp();
    const res = await app.request(`/application?token=${encodeURIComponent(adminToken)}`);
    expect(res.status).toBe(401);
  });

  it("rejects /appdata route even when query token is present", async () => {
    const app = buildApp();
    const res = await app.request(`/appdata?token=${encodeURIComponent(adminToken)}`);
    expect(res.status).toBe(401);
  });

  it("rejects /app/auth bootstrap with invalid query token", async () => {
    const app = buildApp();
    const res = await app.request("/app/auth?token=invalid-token");
    expect(res.status).toBe(401);
  });

  it("prefers /app/auth query token over cookie token", async () => {
    const app = buildApp();
    const res = await app.request("/app/auth?token=invalid-token", {
      headers: { Cookie: `tyrum_admin_token=${encodeURIComponent(adminToken)}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed Authorization header", async () => {
    const app = buildApp();
    const res = await app.request("/api/data", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects Authorization header with empty bearer value", async () => {
    const app = buildApp();
    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });
});
