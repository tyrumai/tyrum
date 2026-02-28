import { describe, expect, it, vi } from "vitest";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createGatewayAuthSession,
  httpAuthForAuth,
  selectAuthForAdminMode,
  wsTokenForAuth,
} from "../src/index.js";

describe("@tyrum/operator-core auth", () => {
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

  it("selects elevated auth only when Admin Mode is active", () => {
    const baseline = createBearerTokenAuth("baseline-token");
    expect(
      selectAuthForAdminMode({
        baseline,
        adminMode: {
          status: "inactive",
          elevatedToken: null,
          enteredAt: null,
          expiresAt: null,
          remainingMs: null,
        },
      }),
    ).toBe(baseline);

    expect(
      selectAuthForAdminMode({
        baseline,
        adminMode: {
          status: "active",
          elevatedToken: "elevated-token",
          enteredAt: "2026-02-27T00:00:00.000Z",
          expiresAt: "2026-02-27T00:01:00.000Z",
          remainingMs: 60_000,
        },
      }),
    ).toEqual({ type: "bearer-token", token: "elevated-token" });
  });

  it("posts gateway auth session bootstrap requests", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

    const res = await createGatewayAuthSession({
      token: "test-token",
      httpBaseUrl: "http://example.test",
      fetch: fetchSpy,
    });

    expect(fetchSpy).toHaveBeenCalledWith("http://example.test/auth/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    });
    expect(res.status).toBe(204);
  });
});
