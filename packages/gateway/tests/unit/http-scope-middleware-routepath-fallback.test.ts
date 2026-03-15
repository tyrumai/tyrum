import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { TokenStore } from "../../src/modules/auth/token-store.js";

vi.mock("hono/route", () => {
  return {
    matchedRoutes: () => [{ path: "/*" }, { path: "/deployment" }],
  };
});

describe("HTTP scope middleware request-path fallback", () => {
  it("rechecks the concrete request path when route metadata is too narrow", async () => {
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");
    const { createHttpScopeAuthorizationMiddleware } =
      await import("../../src/modules/authz/http-scope-middleware.js");

    const tokenStore = {
      authenticate: (token: string) => {
        if (token === "scoped-admin-token") {
          return {
            token_kind: "device",
            role: "client",
            scopes: ["operator.admin"],
          };
        }
        if (token === "scoped-read-token") {
          return {
            token_kind: "device",
            role: "client",
            scopes: ["operator.read"],
          };
        }
        return null;
      },
    } as unknown as TokenStore;

    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore));
    app.use("*", createHttpScopeAuthorizationMiddleware());
    app.get("/config/policy/deployment", (c) => c.json({ ok: true }));

    const adminRes = await app.request("/config/policy/deployment", {
      headers: { Authorization: "Bearer scoped-admin-token" },
    });
    expect(adminRes.status).toBe(200);

    const readRes = await app.request("/config/policy/deployment", {
      headers: { Authorization: "Bearer scoped-read-token" },
    });
    expect(readRes.status).toBe(403);
    await expect(readRes.json()).resolves.toMatchObject({
      error: "forbidden",
      message: "insufficient scope",
    });
  });
});
