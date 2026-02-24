import { afterEach, describe, expect, it } from "vitest";

import { assertNonLoopbackDeploymentGuardrails } from "../../src/index.js";

describe("non-loopback deployment guardrails", () => {
  afterEach(() => {
    delete process.env["TYRUM_TLS_READY"];
    delete process.env["TYRUM_ALLOW_INSECURE_HTTP"];
  });

  it("does not require TLS readiness on loopback hosts", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "127.0.0.1",
        token: "short-token",
      }),
    ).not.toThrow();
  });

  it("treats loopback host:port values as loopback targets", () => {
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "127.0.0.1:8788",
        token: undefined,
      }),
    ).toBe("local");
  });

  it("does not enforce guardrails for non-edge roles", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "worker",
        host: "0.0.0.0",
        token: undefined,
      }),
    ).not.toThrow();
  });

  it("requires a hardened admin token when exposed beyond loopback", () => {
    process.env["TYRUM_ALLOW_INSECURE_HTTP"] = "1";
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "weak-token",
      }),
    ).toThrow(/token/i);
  });

  it("requires TLS readiness unless explicitly allowing insecure HTTP", () => {
    expect(() =>
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
      }),
    ).toThrow(/tls|insecure/i);
  });

  it("accepts explicit insecure HTTP acknowledgement for non-loopback starts", () => {
    process.env["TYRUM_ALLOW_INSECURE_HTTP"] = "1";
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
      }),
    ).toBe("insecure");
  });

  it("accepts TLS readiness acknowledgement for non-loopback starts", () => {
    process.env["TYRUM_TLS_READY"] = "1";
    expect(
      assertNonLoopbackDeploymentGuardrails({
        role: "edge",
        host: "0.0.0.0",
        token: "a".repeat(32),
      }),
    ).toBe("tls");
  });
});
