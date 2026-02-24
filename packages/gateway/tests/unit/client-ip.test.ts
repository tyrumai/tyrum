import { describe, expect, it } from "vitest";
import { createTrustedProxyAllowlistFromEnv } from "../../src/modules/auth/client-ip.js";

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
});

