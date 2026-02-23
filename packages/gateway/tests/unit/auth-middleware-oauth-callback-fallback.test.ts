import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { TokenStore } from "../../src/modules/auth/token-store.js";

vi.mock("hono/route", () => {
  return {
    matchedRoutes: () => [],
  };
});

describe("auth middleware oauth callback bypass fallback", () => {
  it("allows oauth callback when matchedRoutes is empty", async () => {
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");

    const app = new Hono();
    app.use("*", createAuthMiddleware({ validate: () => false } as unknown as TokenStore));
    app.get("/providers/:provider/oauth/callback", (c) => c.text("ok"));
    app.get("/protected", (c) => c.text("ok"));

    const protectedRes = await app.request("/protected");
    expect(protectedRes.status).toBe(401);

    const callbackRes = await app.request("/providers/test/oauth/callback");
    expect(callbackRes.status).toBe(200);
  });

  it("allows oauth callback under a base path prefix when matchedRoutes is empty", async () => {
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");

    const app = new Hono();
    const sub = new Hono();
    sub.use("*", createAuthMiddleware({ validate: () => false } as unknown as TokenStore));
    sub.get("/providers/:provider/oauth/callback", (c) => c.text("ok"));
    app.route("/prefix", sub);

    const res = await app.request("/prefix/providers/test/oauth/callback");
    expect(res.status).toBe(200);
  });

  it("still requires auth for non-callback routes when matchedRoutes is empty", async () => {
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");

    const app = new Hono();
    app.use("*", createAuthMiddleware({ validate: () => false } as unknown as TokenStore));
    app.get("/providers/:provider/oauth/callback2", (c) => c.text("ok"));

    const res = await app.request("/providers/test/oauth/callback2");
    expect(res.status).toBe(401);
  });
});
