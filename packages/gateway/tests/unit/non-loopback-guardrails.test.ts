import { describe, expect, it } from "vitest";

import { assertNonLoopbackDeploymentGuardrails } from "../../src/index.js";

describe("non-loopback deployment guardrails", () => {
  it("does not require TLS readiness on loopback hosts", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "127.0.0.1",
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
        tlsReady: false,
        allowInsecureHttp: false,
      }),
    ).not.toThrow();
  });

  it("requires TLS readiness unless explicitly allowing insecure HTTP", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
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
        tlsReady: true,
        allowInsecureHttp: false,
      }),
    ).toBe("tls");
  });

  it("accepts self-signed TLS acknowledgement for non-loopback starts", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        tlsReady: false,
        allowInsecureHttp: false,
        tlsSelfSigned: true,
      }),
    ).toBe("tls");
  });

  it("requires a tenant admin token before binding to non-loopback hosts", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        tlsReady: true,
        allowInsecureHttp: false,
        hasTenantAdminToken: false,
      }),
    ).toThrow(/token/i);
  });

  it("ignores env flags when explicit acknowledgements are omitted", () => {
    const prevTlsReady = process.env["TYRUM_TLS_READY"];
    const prevAllowInsecureHttp = process.env["TYRUM_ALLOW_INSECURE_HTTP"];
    try {
      process.env["TYRUM_TLS_READY"] = "1";
      delete process.env["TYRUM_ALLOW_INSECURE_HTTP"];

      expect(() =>
        assertNonLoopbackDeploymentGuardrails({
          role: "edge",
          host: "0.0.0.0",
        }),
      ).toThrow(/tls|insecure/i);
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
