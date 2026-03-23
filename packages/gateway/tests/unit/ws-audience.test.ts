/**
 * audience.ts — unit tests for WebSocket audience matching.
 */

import { describe, expect, it } from "vitest";
import { shouldDeliverToWsAudience } from "../../src/ws/audience.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("shouldDeliverToWsAudience", () => {
  it("returns true when no audience filter is provided", () => {
    expect(shouldDeliverToWsAudience({ role: "client" }, undefined)).toBe(true);
  });

  it("returns true when audience is empty (no roles or scopes)", () => {
    expect(shouldDeliverToWsAudience({ role: "client" }, {})).toBe(true);
  });

  it("returns true when client role is in the audience roles", () => {
    expect(shouldDeliverToWsAudience({ role: "client" }, { roles: ["client"] })).toBe(true);
  });

  it("returns false when client role is not in the audience roles", () => {
    expect(shouldDeliverToWsAudience({ role: "node" }, { roles: ["client"] })).toBe(false);
  });

  it("returns true when roles array is empty (no role filter)", () => {
    expect(shouldDeliverToWsAudience({ role: "node" }, { roles: [] })).toBe(true);
  });

  it("returns false when required scopes are set but client has no claims", () => {
    expect(
      shouldDeliverToWsAudience({ role: "client" }, { required_scopes: ["operator.read"] }),
    ).toBe(false);
  });

  it("returns true for admin token_kind regardless of scopes", () => {
    expect(
      shouldDeliverToWsAudience(
        {
          role: "client",
          auth_claims: {
            token_kind: "admin",
            token_id: "tok-1",
            tenant_id: DEFAULT_TENANT_ID,
            role: "admin",
            scopes: [],
          },
        },
        { required_scopes: ["operator.admin"] },
      ),
    ).toBe(true);
  });

  it("returns true when client has matching scope", () => {
    expect(
      shouldDeliverToWsAudience(
        {
          role: "client",
          auth_claims: {
            token_kind: "device",
            token_id: "tok-2",
            tenant_id: DEFAULT_TENANT_ID,
            role: "client",
            scopes: ["operator.read"],
          },
        },
        { required_scopes: ["operator.read"] },
      ),
    ).toBe(true);
  });

  it("returns false when client does not have the required scope", () => {
    expect(
      shouldDeliverToWsAudience(
        {
          role: "client",
          auth_claims: {
            token_kind: "device",
            token_id: "tok-3",
            tenant_id: DEFAULT_TENANT_ID,
            role: "client",
            scopes: ["operator.read"],
          },
        },
        { required_scopes: ["operator.admin"] },
      ),
    ).toBe(false);
  });

  it("respects both role and scope filters", () => {
    // Wrong role
    expect(
      shouldDeliverToWsAudience(
        {
          role: "node",
          auth_claims: {
            token_kind: "device",
            token_id: "tok-4",
            tenant_id: DEFAULT_TENANT_ID,
            role: "client",
            scopes: ["operator.read"],
          },
        },
        { roles: ["client"], required_scopes: ["operator.read"] },
      ),
    ).toBe(false);
  });

  it("returns true when required_scopes is an empty array", () => {
    expect(shouldDeliverToWsAudience({ role: "client" }, { required_scopes: [] })).toBe(true);
  });
});
