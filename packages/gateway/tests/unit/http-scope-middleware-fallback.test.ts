import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { TokenStore } from "../../src/modules/auth/token-store.js";

vi.mock("hono/route", () => {
  return {
    matchedRoutes: () => [],
  };
});

describe("HTTP scope middleware route-metadata fallback", () => {
  it("fails closed when matchedRoutes is empty", async () => {
    const { createAuthMiddleware } = await import("../../src/modules/auth/middleware.js");
    const { createHttpScopeAuthorizationMiddleware } =
      await import("../../src/modules/authz/http-scope-middleware.js");

    const tokenStore = {
      authenticate: (token: string) => {
        if (token === "scoped-device-token") {
          return {
            token_kind: "device",
            role: "client",
            scopes: [],
          };
        }
        return null;
      },
    } as unknown as TokenStore;

    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore));
    app.use("*", createHttpScopeAuthorizationMiddleware());
    app.get("/auth/pins", (c) => c.json({ pins: [] }));

    const res = await app.request("/auth/pins", {
      headers: { Authorization: "Bearer scoped-device-token" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("forbidden");
  });
});
