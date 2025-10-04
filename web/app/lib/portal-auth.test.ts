import { describe, expect, it } from "vitest";
import { isProtectedPortalPath } from "./portal-auth";

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
