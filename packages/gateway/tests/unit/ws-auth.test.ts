/**
 * Unit tests for WebSocket token authentication.
 *
 * Validates that `validateWsToken` requires the gateway token store.
 */

import { describe, expect, it } from "vitest";
import { validateWsToken } from "../../src/ws/auth.js";
import type { TokenStore } from "../../src/modules/auth/token-store.js";

describe("validateWsToken", () => {
  const tokenStore = {
    validate(candidate: string) {
      return candidate === "admin-123";
    },
  } as unknown as TokenStore;

  it("returns false when tokenStore is missing", () => {
    expect(validateWsToken("admin-123")).toBe(false);
  });

  it("validates against tokenStore", () => {
    expect(validateWsToken("admin-123", tokenStore)).toBe(true);
    expect(validateWsToken("wrong", tokenStore)).toBe(false);
    expect(validateWsToken(undefined, tokenStore)).toBe(false);
  });
});
