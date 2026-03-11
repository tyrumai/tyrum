import { describe, expect, it } from "vitest";
import { hasAnyRequiredScope } from "../../src/modules/auth/scopes.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

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
});
