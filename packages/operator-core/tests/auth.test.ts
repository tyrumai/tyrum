import { describe, expect, it } from "vitest";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
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
});
