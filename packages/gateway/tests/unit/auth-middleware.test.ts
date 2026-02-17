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

  function buildApp(isLocalOnly: boolean): Hono {
    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore, isLocalOnly));
    app.get("/healthz", (c) => c.json({ status: "ok" }));
    app.get("/api/data", (c) => c.json({ data: "secret" }));
    app.post("/api/action", (c) => c.json({ done: true }));
    return app;
  }

  it("allows /healthz without token", async () => {
    const app = buildApp(false);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("allows all requests when isLocalOnly is true", async () => {
    const app = buildApp(true);
    const res = await app.request("/api/data");
    expect(res.status).toBe(200);
  });

  it("rejects requests without token when not local", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/data");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects requests with wrong token", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("allows requests with correct token", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/data", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string };
    expect(body.data).toBe("secret");
  });

  it("rejects malformed Authorization header", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/data", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects Authorization header with empty bearer value", async () => {
    const app = buildApp(false);
    const res = await app.request("/api/data", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });
});
