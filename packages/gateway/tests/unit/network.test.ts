/**
 * network.ts — unit tests for bootstrap network utilities.
 */

import { describe, expect, it } from "vitest";
import {
  splitHostAndPort,
  isLoopbackOnlyHost,
  assertNonLoopbackDeploymentGuardrails,
} from "../../src/bootstrap/network.js";

describe("splitHostAndPort", () => {
  it("splits a simple host:port", () => {
    expect(splitHostAndPort("localhost:8080")).toEqual({ host: "localhost", port: "8080" });
  });

  it("returns null port for host without port", () => {
    expect(splitHostAndPort("localhost")).toEqual({ host: "localhost", port: null });
  });

  it("handles empty string", () => {
    expect(splitHostAndPort("")).toEqual({ host: "", port: null });
  });

  it("handles whitespace-only input", () => {
    expect(splitHostAndPort("   ")).toEqual({ host: "", port: null });
  });

  it("handles IPv4 address with port", () => {
    expect(splitHostAndPort("127.0.0.1:3000")).toEqual({ host: "127.0.0.1", port: "3000" });
  });

  it("handles IPv4 address without port", () => {
    expect(splitHostAndPort("10.0.0.1")).toEqual({ host: "10.0.0.1", port: null });
  });

  it("handles bracketed IPv6 address with port", () => {
    expect(splitHostAndPort("[::1]:8080")).toEqual({ host: "::1", port: "8080" });
  });

  it("handles bracketed IPv6 address without port", () => {
    expect(splitHostAndPort("[::1]")).toEqual({ host: "::1", port: null });
  });

  it("handles bare IPv6 address without brackets (no port)", () => {
    const result = splitHostAndPort("::1");
    expect(result.host).toContain(":");
  });

  it("handles bracketed IPv6 with non-numeric port", () => {
    expect(splitHostAndPort("[::1]:abc")).toEqual({ host: "::1", port: null });
  });

  it("returns host with no port when colon but no valid port part", () => {
    expect(splitHostAndPort("host:")).toEqual({ host: "host:", port: null });
  });
});

describe("isLoopbackOnlyHost", () => {
  it("returns true for localhost", () => {
    expect(isLoopbackOnlyHost("localhost")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLoopbackOnlyHost("127.0.0.1")).toBe(true);
  });

  it("returns true for 127.x.x.x addresses", () => {
    expect(isLoopbackOnlyHost("127.0.0.2")).toBe(true);
    expect(isLoopbackOnlyHost("127.255.255.255")).toBe(true);
  });

  it("returns true for ::1", () => {
    expect(isLoopbackOnlyHost("::1")).toBe(true);
  });

  it("returns true for bracketed ::1", () => {
    expect(isLoopbackOnlyHost("[::1]")).toBe(true);
  });

  it("returns false for 0.0.0.0", () => {
    expect(isLoopbackOnlyHost("0.0.0.0")).toBe(false);
  });

  it("returns false for non-loopback addresses", () => {
    expect(isLoopbackOnlyHost("10.0.0.1")).toBe(false);
    expect(isLoopbackOnlyHost("192.168.1.1")).toBe(false);
  });

  it("returns false for non-IP hostnames", () => {
    expect(isLoopbackOnlyHost("example.com")).toBe(false);
  });

  it("is case-insensitive for localhost", () => {
    expect(isLoopbackOnlyHost("LOCALHOST")).toBe(true);
    expect(isLoopbackOnlyHost("LocalHost")).toBe(true);
  });
});

describe("assertNonLoopbackDeploymentGuardrails", () => {
  it("returns 'local' for loopback hosts", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "all",
        host: "localhost",
      }),
    ).toBe("local");
  });

  it("returns 'local' for non-edge roles", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "worker",
        host: "0.0.0.0",
      }),
    ).toBe("local");
  });

  it("returns 'local' for scheduler role", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "scheduler",
        host: "10.0.0.1",
      }),
    ).toBe("local");
  });

  it("throws when no tenant admin token exists on non-loopback", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "all",
        host: "10.0.0.1",
        hasTenantAdminToken: false,
      }),
    ).toThrow(/no tenant admin tokens exist/);
  });

  it("returns 'tls' when tlsReady is true", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "all",
        host: "10.0.0.1",
        tlsReady: true,
      }),
    ).toBe("tls");
  });

  it("returns 'insecure' when allowInsecureHttp is true", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "all",
        host: "10.0.0.1",
        allowInsecureHttp: true,
      }),
    ).toBe("insecure");
  });

  it("throws when non-loopback and no TLS configuration", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "10.0.0.1",
      }),
    ).toThrow(/Remote operation requires TLS/);
  });
});
