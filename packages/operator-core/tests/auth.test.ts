import { describe, expect, it } from "vitest";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  httpAuthForAuth,
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
});
