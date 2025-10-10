import { afterEach, describe, expect, it } from "vitest";
import {
  PORTAL_SESSION_SECRET_ENV,
  computePortalSessionTokenFromSecret,
  isPortalSessionTokenValid,
  isProtectedPortalPath,
  clearPortalSessionSecretForTesting,
  requirePortalSessionSecret,
  setPortalSessionSecretForTesting,
} from "./portal-auth";

describe("isProtectedPortalPath", () => {
  it("ignores non-portal routes", () => {
    expect(isProtectedPortalPath("/consent")).toBe(false);
  });

  it("allows onboarding routes to bypass guards", () => {
    expect(isProtectedPortalPath("/portal/onboarding")).toBe(false);
    expect(isProtectedPortalPath("/portal/onboarding/welcome")).toBe(false);
  });

  it("allows auth routes to bypass guards", () => {
    expect(isProtectedPortalPath("/portal/auth")).toBe(false);
    expect(isProtectedPortalPath("/portal/auth/reset")).toBe(false);
  });

  it("protects portal root and nested paths", () => {
    expect(isProtectedPortalPath("/portal")).toBe(true);
    expect(isProtectedPortalPath("/portal/inbox")).toBe(true);
  });
});

describe("portal session verification", () => {
  const secret = "test-portals-secret";
  const originalEnv = process.env[PORTAL_SESSION_SECRET_ENV];

  afterEach(() => {
    clearPortalSessionSecretForTesting();
    if (originalEnv === undefined) {
      delete process.env[PORTAL_SESSION_SECRET_ENV];
    } else {
      process.env[PORTAL_SESSION_SECRET_ENV] = originalEnv;
    }
  });

  it("derives deterministic tokens from the configured secret", () => {
    const first = computePortalSessionTokenFromSecret(secret);
    const second = computePortalSessionTokenFromSecret(secret);
    const different = computePortalSessionTokenFromSecret(`${secret}-other`);

    expect(first).toBe(second);
    expect(different).not.toBe(first);
  });

  it("validates tokens against the current secret", () => {
    const token = computePortalSessionTokenFromSecret(secret);
    setPortalSessionSecretForTesting(secret);

    expect(isPortalSessionTokenValid(token)).toBe(true);
    expect(isPortalSessionTokenValid(`${token}-tampered`)).toBe(false);
  });

  it("throws when the portal secret is missing", () => {
    setPortalSessionSecretForTesting(undefined);

    expect(() => {
      requirePortalSessionSecret();
    }).toThrowErrorMatchingInlineSnapshot(
      `[Error: PORTAL_SESSION_SECRET must be configured for portal verification stubs.]`,
    );
  });
});
