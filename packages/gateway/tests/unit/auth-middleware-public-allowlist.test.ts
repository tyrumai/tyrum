import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAuthMiddleware, PUBLIC_PATHS } from "../../src/modules/auth/middleware.js";

describe("auth middleware public allowlist", () => {
  it("exports a single explicit allowlist with the expected labels", () => {
    expect(PUBLIC_PATHS.map((entry) => entry.label)).toEqual([
      "/healthz",
      "/ui/*",
      "/auth/session",
      "/auth/logout",
      "/providers/:provider/oauth/callback",
    ]);
  });

  it("fails closed with 503 when tokenStore is undefined", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(undefined));
    app.get("/healthz", (c) => c.text("ok"));

    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("service_unavailable");
    expect(body.message).toBeTypeOf("string");
    expect(body.message).not.toContain("Bearer");
  });
});
