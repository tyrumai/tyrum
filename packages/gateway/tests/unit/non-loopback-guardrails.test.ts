import { describe, expect, it } from "vitest";

import { assertNonLoopbackDeploymentGuardrails } from "../../src/index.js";

describe("non-loopback deployment guardrails", () => {
  it("does not require TLS readiness on loopback hosts", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "127.0.0.1",
        token: "short-token",
        tlsReady: false,
        allowInsecureHttp: false,
      }),
    ).not.toThrow();
  });

  it("treats loopback host:port values as loopback targets", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "127.0.0.1:8788",
        token: undefined,
        tlsReady: false,
        allowInsecureHttp: false,
      }),
    ).toBe("local");
  });

  it("does not enforce guardrails for non-edge roles", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "worker",
        host: "0.0.0.0",
        token: undefined,
        tlsReady: false,
        allowInsecureHttp: false,
      }),
    ).not.toThrow();
  });

  it("requires a hardened admin token when exposed beyond loopback", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "weak-token",
        tlsReady: false,
        allowInsecureHttp: true,
      }),
    ).toThrow(/token/i);
  });

  it("requires TLS readiness unless explicitly allowing insecure HTTP", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
        tlsReady: false,
        allowInsecureHttp: false,
      }),
    ).toThrow(/tls|insecure/i);
  });

  it("accepts explicit insecure HTTP acknowledgement for non-loopback starts", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
        tlsReady: false,
        allowInsecureHttp: true,
      }),
    ).toBe("insecure");
  });

  it("accepts TLS readiness acknowledgement for non-loopback starts", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
        tlsReady: true,
        allowInsecureHttp: false,
      }),
    ).toBe("tls");
  });

  it("falls back to env flags when explicit acknowledgements are omitted", () => {
    const prevTlsReady = process.env["TYRUM_TLS_READY"];
    const prevAllowInsecureHttp = process.env["TYRUM_ALLOW_INSECURE_HTTP"];
    try {
      process.env["TYRUM_TLS_READY"] = "1";
      delete process.env["TYRUM_ALLOW_INSECURE_HTTP"];

      expect(
        assertNonLoopbackDeploymentGuardrails({
          role: "edge",
          host: "0.0.0.0",
          token: "a".repeat(32),
        }),
      ).toBe("tls");
    } finally {
      if (prevTlsReady === undefined) {
        delete process.env["TYRUM_TLS_READY"];
      } else {
        process.env["TYRUM_TLS_READY"] = prevTlsReady;
      }

      if (prevAllowInsecureHttp === undefined) {
        delete process.env["TYRUM_ALLOW_INSECURE_HTTP"];
      } else {
        process.env["TYRUM_ALLOW_INSECURE_HTTP"] = prevAllowInsecureHttp;
      }
    }
  });
});
