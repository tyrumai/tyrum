import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import {
  createTrustedProxyAllowlistFromEnv,
  getClientIp,
  resolveClientIp,
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
});
