import { describe, expect, it, vi } from "vitest";
import {
  clearGatewayAuthCookie,
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createGatewayAuthCookie,
  httpAuthForAuth,
  selectAuthForElevatedMode,
  wsTokenForAuth,
} from "../src/index.js";

describe("@tyrum/operator-app auth", () => {
  it("maps operator auth to WS token", () => {
    expect(wsTokenForAuth(createBrowserCookieAuth())).toBe("");
    expect(wsTokenForAuth(createBearerTokenAuth("test-token"))).toBe("test-token");
  });

  it("maps operator auth to HTTP auth strategy", () => {
    expect(httpAuthForAuth(createBrowserCookieAuth({ credentials: "include" }))).toEqual({
      type: "cookie",
      credentials: "include",
    });
    expect(httpAuthForAuth(createBearerTokenAuth("test-token"))).toEqual({
      type: "bearer",
      token: "test-token",
    });
  });

  it("selects elevated auth only when Elevated Mode is active", () => {
    const baseline = createBearerTokenAuth("baseline-token");
    expect(
      selectAuthForElevatedMode({
        baseline,
        elevatedMode: {
          status: "inactive",
          elevatedToken: null,
          enteredAt: null,
          expiresAt: null,
          remainingMs: null,
        },
      }),
    ).toBe(baseline);

    expect(
      selectAuthForElevatedMode({
        baseline,
        elevatedMode: {
          status: "active",
          elevatedToken: "elevated-token",
          enteredAt: "2026-02-27T00:00:00.000Z",
          expiresAt: null,
          remainingMs: null,
        },
      }),
    ).toEqual({ type: "bearer-token", token: "elevated-token" });
  });

  it("posts gateway auth cookie bootstrap requests", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const res = await createGatewayAuthCookie({
      token: "test-token",
      httpBaseUrl: "http://example.test",
      fetch: fetchSpy,
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://example.test/auth/cookie", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    });
    expect(res.status).toBe(204);
  });

  it("posts gateway auth cookie logout requests", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const res = await clearGatewayAuthCookie({
      httpBaseUrl: "http://example.test",
      fetch: fetchSpy,
      credentials: "include",
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://example.test/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    expect(res.status).toBe(204);
  });
});
