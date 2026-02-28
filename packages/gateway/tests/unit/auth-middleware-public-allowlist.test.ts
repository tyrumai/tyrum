import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { TokenStore } from "../../src/modules/auth/token-store.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";

describe("auth middleware public allowlist", () => {
  it("exports a single explicit allowlist with the expected labels", async () => {
    const mod = (await import("../../src/modules/auth/middleware.js")) as Record<string, unknown>;
    const publicPaths = mod["PUBLIC_PATHS"];
    expect(Array.isArray(publicPaths)).toBe(true);

    const labels = (publicPaths as Array<{ label?: unknown }>).map((entry) => entry.label);
    expect(labels).toEqual([
      "/healthz",
      "/ui/*",
      "/auth/session",
      "/auth/logout",
      "/providers/:provider/oauth/callback",
    ]);
  });

  it("fails closed with 503 when tokenStore is undefined", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(undefined as unknown as TokenStore));
    app.get("/healthz", (c) => c.text("ok"));

    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("unauthorized");
  });
});

