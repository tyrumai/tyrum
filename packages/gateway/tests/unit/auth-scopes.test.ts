import { describe, expect, it } from "vitest";
import {
  hasAnyRequiredScope,
  normalizeScopes,
  isBreakGlassAdmin,
} from "../../src/modules/auth/scopes.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("normalizeScopes", () => {
  it("returns an empty array for undefined input", () => {
    expect(normalizeScopes(undefined)).toEqual([]);
  });

  it("trims whitespace from scopes", () => {
    expect(normalizeScopes(["  read  ", "  write  "])).toEqual(["read", "write"]);
  });

  it("removes empty strings after trim", () => {
    expect(normalizeScopes(["read", "   ", "", "write"])).toEqual(["read", "write"]);
  });

  it("deduplicates scopes", () => {
    expect(normalizeScopes(["read", "read", "write"])).toEqual(["read", "write"]);
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeScopes("not-an-array" as unknown as string[])).toEqual([]);
  });
});

describe("isBreakGlassAdmin", () => {
  it("returns true for admin token_kind", () => {
    expect(isBreakGlassAdmin({ token_kind: "admin" })).toBe(true);
  });

  it("returns false for device token_kind", () => {
    expect(isBreakGlassAdmin({ token_kind: "device" })).toBe(false);
  });

  it("returns false for other token_kind values", () => {
    expect(isBreakGlassAdmin({ token_kind: "tenant" as "admin" })).toBe(false);
  });
});

describe("hasAnyRequiredScope", () => {
  it("treats admin claims as break-glass even when scopes are empty", () => {
    expect(
      hasAnyRequiredScope(
        {
          token_kind: "admin",
          token_id: "token-admin-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: [],
        },
        ["operator.admin"],
      ),
    ).toBe(true);
  });

  it("still enforces explicit scopes for device tokens", () => {
    expect(
      hasAnyRequiredScope(
        {
          token_kind: "device",
          token_id: "token-device-1",
          tenant_id: DEFAULT_TENANT_ID,
          device_id: "device-1",
          role: "client",
          scopes: ["operator.read"],
        },
        ["operator.write"],
      ),
    ).toBe(false);
  });

  it("returns true when no required scopes are specified", () => {
    expect(
      hasAnyRequiredScope(
        {
          token_kind: "device",
          token_id: "tok",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          scopes: [],
        },
        [],
      ),
    ).toBe(true);
  });

  it("returns true when scopes include wildcard *", () => {
    expect(
      hasAnyRequiredScope(
        {
          token_kind: "device",
          token_id: "tok",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          scopes: ["*"],
        },
        ["operator.admin"],
      ),
    ).toBe(true);
  });

  it("returns true when at least one required scope is present", () => {
    expect(
      hasAnyRequiredScope(
        {
          token_kind: "device",
          token_id: "tok",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          scopes: ["operator.read", "operator.admin"],
        },
        ["operator.admin", "operator.write"],
      ),
    ).toBe(true);
  });
});
