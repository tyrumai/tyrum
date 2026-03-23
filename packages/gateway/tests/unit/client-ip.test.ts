import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Context } from "hono";
import {
  createTrustedProxyAllowlistFromEnv,
  getClientIp,
  resolveClientIpFromRequest,
  resolveClientIp,
  toSingleHeaderValue,
} from "../../src/modules/auth/client-ip.js";

describe("trusted proxy allowlist parsing", () => {
  it("returns undefined when unset", () => {
    expect(createTrustedProxyAllowlistFromEnv(undefined)).toBeUndefined();
    expect(createTrustedProxyAllowlistFromEnv("")).toBeUndefined();
    expect(createTrustedProxyAllowlistFromEnv("   ")).toBeUndefined();
  });

  it("rejects malformed CIDR prefixes", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("10.0.0.0/")).toThrow();
    expect(() => createTrustedProxyAllowlistFromEnv("10.0.0.0/not-a-number")).toThrow();
  });

  it("rejects /0 allowlists as unsafe", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("0.0.0.0/0")).toThrow();
    expect(() => createTrustedProxyAllowlistFromEnv("::/0")).toThrow();
  });

  it("falls back to X-Forwarded-For when Forwarded is present but invalid", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("127.0.0.1");
    expect(allowlist).toBeDefined();

    const ip = resolveClientIp({
      remoteAddress: "127.0.0.1",
      forwardedHeader: "for=not-an-ip",
      xForwardedForHeader: "198.51.100.10",
      xRealIpHeader: undefined,
      trustedProxies: allowlist,
    });

    expect(ip).toBe("198.51.100.10");
  });

  it("returns raw and resolved request IPs when a trusted proxy forwards the client IP", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("127.0.0.1");
    expect(allowlist).toBeDefined();

    const request = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "203.0.113.9" },
    } as IncomingMessage;

    expect(resolveClientIpFromRequest(request, allowlist)).toEqual({
      rawRemoteIp: "127.0.0.1",
      resolvedClientIp: "203.0.113.9",
    });
  });

  it("ignores forwarded request headers when the remote peer is not trusted", () => {
    const request = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "203.0.113.9" },
    } as IncomingMessage;

    expect(resolveClientIpFromRequest(request, undefined)).toEqual({
      rawRemoteIp: "127.0.0.1",
      resolvedClientIp: "127.0.0.1",
    });
  });
});

describe("resolveClientIp", () => {
  it("returns undefined when remoteAddress is undefined", () => {
    expect(
      resolveClientIp({
        remoteAddress: undefined,
        forwardedHeader: undefined,
        xForwardedForHeader: undefined,
        xRealIpHeader: undefined,
        trustedProxies: undefined,
      }),
    ).toBeUndefined();
  });

  it("returns remoteAddress when no trusted proxies are configured", () => {
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedHeader: undefined,
        xForwardedForHeader: "1.2.3.4",
        xRealIpHeader: undefined,
        trustedProxies: undefined,
      }),
    ).toBe("10.0.0.1");
  });

  it("uses Forwarded header when present and remote is trusted proxy", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("10.0.0.1");
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedHeader: "for=192.168.1.1",
        xForwardedForHeader: undefined,
        xRealIpHeader: undefined,
        trustedProxies: allowlist,
      }),
    ).toBe("192.168.1.1");
  });

  it("falls back to X-Real-IP when Forwarded and X-Forwarded-For are absent", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("10.0.0.1");
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedHeader: undefined,
        xForwardedForHeader: undefined,
        xRealIpHeader: "172.16.0.5",
        trustedProxies: allowlist,
      }),
    ).toBe("172.16.0.5");
  });

  it("returns remoteAddress when headers are empty and peer is trusted", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("10.0.0.1");
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedHeader: undefined,
        xForwardedForHeader: undefined,
        xRealIpHeader: undefined,
        trustedProxies: allowlist,
      }),
    ).toBe("10.0.0.1");
  });
});

describe("trusted proxy allowlist with subnets", () => {
  it("accepts valid IPv4 CIDR subnets", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("10.0.0.0/8");
    expect(allowlist).toBeDefined();
    expect(allowlist!.isTrustedProxy("10.1.2.3")).toBe(true);
    expect(allowlist!.isTrustedProxy("192.168.1.1")).toBe(false);
  });

  it("rejects out-of-range prefixes", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("10.0.0.0/33")).toThrow();
  });

  it("rejects invalid IP in CIDR notation", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("not-an-ip/8")).toThrow();
  });

  it("rejects empty IP in CIDR notation", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("/8")).toThrow();
  });

  it("rejects single invalid address", () => {
    expect(() => createTrustedProxyAllowlistFromEnv("not-an-ip")).toThrow();
  });

  it("returns false for isTrustedProxy with invalid input", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("127.0.0.1");
    expect(allowlist!.isTrustedProxy("")).toBe(false);
    expect(allowlist!.isTrustedProxy("not-an-ip")).toBe(false);
  });

  it("handles multiple entries separated by commas", () => {
    const allowlist = createTrustedProxyAllowlistFromEnv("10.0.0.1, 192.168.1.1");
    expect(allowlist!.isTrustedProxy("10.0.0.1")).toBe(true);
    expect(allowlist!.isTrustedProxy("192.168.1.1")).toBe(true);
    expect(allowlist!.isTrustedProxy("172.16.0.1")).toBe(false);
  });
});

describe("toSingleHeaderValue", () => {
  it("returns the first element of an array", () => {
    expect(toSingleHeaderValue(["first", "second"])).toBe("first");
  });

  it("returns the string directly for single string input", () => {
    expect(toSingleHeaderValue("value")).toBe("value");
  });

  it("returns undefined for undefined input", () => {
    expect(toSingleHeaderValue(undefined)).toBeUndefined();
  });
});

describe("getClientIp", () => {
  it("returns undefined when the Context accessor throws", () => {
    const c = {
      get: () => {
        throw new Error("boom");
      },
    } as unknown as Context;

    expect(getClientIp(c)).toBeUndefined();
  });

  it("returns undefined when clientIp is not a string", () => {
    const c = {
      get: () => 42,
    } as unknown as Context;

    expect(getClientIp(c)).toBeUndefined();
  });

  it("returns normalized IP when clientIp is a valid string", () => {
    const c = {
      get: () => "  127.0.0.1  ",
    } as unknown as Context;

    expect(getClientIp(c)).toBe("127.0.0.1");
  });
});
