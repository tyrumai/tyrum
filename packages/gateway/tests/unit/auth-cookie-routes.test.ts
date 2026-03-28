/**
 * auth-cookie.ts — unit tests for auth cookie routes.
 *
 * Tests the branch paths for POST /auth/cookie and POST /auth/logout.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAuthCookieRoutes } from "../../src/routes/auth-cookie.js";
import type { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";

function makeAuthTokens(overrides: Partial<AuthTokenService> = {}): AuthTokenService {
  return {
    authenticate: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as AuthTokenService;
}

function buildApp(authTokens: AuthTokenService): Hono {
  const app = new Hono();
  app.route("/", createAuthCookieRoutes({ authTokens }));
  return app;
}

describe("POST /auth/cookie", () => {
  it("returns 400 for invalid JSON body", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("returns 400 when token is missing from body", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toBe("token is required");
  });

  it("returns 400 when token is an empty string", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "  " }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("token is required");
  });

  it("returns 400 when token is not a string", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: 12345 }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("token is required");
  });

  it("returns 400 when body is an array", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify([{ token: "abc" }]),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("token is required");
  });

  it("returns 401 when authentication fails", async () => {
    const authTokens = makeAuthTokens({
      authenticate: vi.fn().mockResolvedValue(null),
    });
    const app = buildApp(authTokens);
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "invalid-token" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 403 for system tokens (tenant_id === null)", async () => {
    const authTokens = makeAuthTokens({
      authenticate: vi.fn().mockResolvedValue({
        token_id: "tok-1",
        tenant_id: null,
        role: "admin",
        scopes: ["*"],
      }),
    });
    const app = buildApp(authTokens);
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "system-token" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("system tokens cannot start conversations");
  });

  it("returns 403 for non-admin tenant tokens", async () => {
    const authTokens = makeAuthTokens({
      authenticate: vi.fn().mockResolvedValue({
        token_id: "tok-2",
        tenant_id: "t1",
        role: "viewer",
        scopes: ["read"],
      }),
    });
    const app = buildApp(authTokens);
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "viewer-token" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("admin token required");
  });

  it("returns 204 and sets cookie for valid admin token", async () => {
    const authTokens = makeAuthTokens({
      authenticate: vi.fn().mockResolvedValue({
        token_id: "tok-3",
        tenant_id: "t1",
        role: "admin",
        scopes: ["*"],
      }),
    });
    const app = buildApp(authTokens);
    const res = await app.request("/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "admin-token" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("admin-token");
  });

  it("sets secure=true cookie for HTTPS requests", async () => {
    const authTokens = makeAuthTokens({
      authenticate: vi.fn().mockResolvedValue({
        token_id: "tok-4",
        tenant_id: "t1",
        role: "admin",
        scopes: ["*"],
      }),
    });
    const app = buildApp(authTokens);
    const res = await app.request("https://example.com/auth/cookie", {
      method: "POST",
      body: JSON.stringify({ token: "admin-token" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Secure");
  });
});

describe("POST /auth/logout", () => {
  it("returns 204 and clears the cookie", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("Max-Age=0");
  });

  it("sets Secure cookie flag for HTTPS logout requests", async () => {
    const app = buildApp(makeAuthTokens());
    const res = await app.request("https://example.com/auth/logout", {
      method: "POST",
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Secure");
  });
});
