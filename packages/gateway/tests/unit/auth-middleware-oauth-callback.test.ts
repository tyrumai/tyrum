import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { TokenStore } from "../../src/modules/auth/token-store.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";

describe("auth middleware oauth callback bypass", () => {
  it("allows GET /providers/:provider/oauth/callback without an admin token", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware({ validate: () => false } as unknown as TokenStore));
    app.get("/providers/:provider/oauth/callback", (c) => c.text("ok"));
    app.get("/protected", (c) => c.text("ok"));

    const protectedRes = await app.request("/protected");
    expect(protectedRes.status).toBe(401);

    const callbackRes = await app.request("/providers/test/oauth/callback");
    expect(callbackRes.status).toBe(200);
  });

  it("still requires an admin token for non-callback routes", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware({ validate: () => false } as unknown as TokenStore));
    app.get("/providers/:provider/oauth/callback2", (c) => c.text("ok"));

    const res = await app.request("/providers/test/oauth/callback2");
    expect(res.status).toBe(401);
  });
});
