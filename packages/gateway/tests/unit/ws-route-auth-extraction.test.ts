import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_NAME } from "../../src/modules/auth/http.js";
import { extractWsTokenWithTransport, selectWsSubprotocol } from "../../src/routes/ws/auth.js";

function createRequest(input: {
  authorization?: string;
  cookie?: string;
  host?: string;
  origin?: string;
  protocol?: string | string[];
}) {
  return {
    headers: {
      authorization: input.authorization,
      cookie: input.cookie,
      host: input.host,
      origin: input.origin,
      "sec-websocket-protocol": input.protocol,
    },
    socket: {},
  } as never;
}

describe("WS route auth extraction", () => {
  it("prefers Authorization over cookies and subprotocol tokens", () => {
    const request = createRequest({
      authorization: "Bearer bearer-token",
      cookie: `${AUTH_COOKIE_NAME}=cookie-token`,
      protocol: [
        "tyrum-v1",
        `tyrum-auth.${Buffer.from("proto-token", "utf-8").toString("base64url")}`,
      ],
    });

    expect(extractWsTokenWithTransport(request)).toEqual({
      token: "bearer-token",
      transport: "authorization",
    });
  });

  it("accepts same-origin auth cookies for WS upgrades", () => {
    const request = createRequest({
      cookie: `${AUTH_COOKIE_NAME}=cookie-token`,
      host: "gateway.example.test",
      origin: "https://gateway.example.test",
    });

    expect(extractWsTokenWithTransport(request)).toEqual({
      token: "cookie-token",
      transport: "cookie",
    });
  });

  it("rejects cross-origin auth cookies while preserving the cookie transport signal", () => {
    const request = createRequest({
      cookie: `${AUTH_COOKIE_NAME}=cookie-token`,
      host: "gateway.example.test",
      origin: "https://evil.example.test",
    });

    expect(extractWsTokenWithTransport(request)).toEqual({
      token: undefined,
      transport: "cookie",
    });
  });

  it("falls back to auth subprotocol tokens when headers do not carry auth", () => {
    const request = createRequest({
      protocol: [
        "tyrum-v1",
        `tyrum-auth.${Buffer.from("proto-token", "utf-8").toString("base64url")}`,
      ],
    });

    expect(extractWsTokenWithTransport(request)).toEqual({
      token: "proto-token",
      transport: "subprotocol",
    });
  });

  it("prefers the base protocol and ignores auth metadata protocols", () => {
    expect(
      selectWsSubprotocol(new Set(["tyrum-auth.ignored", "custom-protocol", "tyrum-v1"])),
    ).toBe("tyrum-v1");

    expect(selectWsSubprotocol(new Set(["tyrum-auth.ignored", "custom-protocol"]))).toBe(
      "custom-protocol",
    );
  });
});
