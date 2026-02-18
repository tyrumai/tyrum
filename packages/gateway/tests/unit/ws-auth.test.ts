/**
 * Unit tests for WebSocket token authentication.
 *
 * Validates that `validateWsToken` correctly gates access based on the
 * `GATEWAY_WS_TOKEN` override and token-store fallback behavior.
 */

import { afterEach, describe, expect, it } from "vitest";
import { validateWsToken } from "../../src/ws/auth.js";
import type { TokenStore } from "../../src/modules/auth/token-store.js";

// ---------------------------------------------------------------------------
// Save / restore process.env around each test
// ---------------------------------------------------------------------------

describe("validateWsToken", () => {
  const originalEnv = process.env["GATEWAY_WS_TOKEN"];
  const tokenStore = {
    validate(candidate: string) {
      return candidate === "admin-123";
    },
  } as unknown as TokenStore;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["GATEWAY_WS_TOKEN"];
    } else {
      process.env["GATEWAY_WS_TOKEN"] = originalEnv;
    }
  });

  // -------------------------------------------------------------------------
  // GATEWAY_WS_TOKEN is set
  // -------------------------------------------------------------------------

  it("returns true when token matches GATEWAY_WS_TOKEN", () => {
    process.env["GATEWAY_WS_TOKEN"] = "secret-42";
    expect(validateWsToken("secret-42")).toBe(true);
  });

  it("returns false when token does not match GATEWAY_WS_TOKEN", () => {
    process.env["GATEWAY_WS_TOKEN"] = "secret-42";
    expect(validateWsToken("wrong-token")).toBe(false);
  });

  it("returns false when token is undefined but GATEWAY_WS_TOKEN is set", () => {
    process.env["GATEWAY_WS_TOKEN"] = "secret-42";
    expect(validateWsToken(undefined)).toBe(false);
  });

  it("returns false when GATEWAY_WS_TOKEN is not set and tokenStore is missing", () => {
    delete process.env["GATEWAY_WS_TOKEN"];
    expect(validateWsToken(undefined)).toBe(false);
  });

  it("validates against tokenStore when GATEWAY_WS_TOKEN is not set", () => {
    delete process.env["GATEWAY_WS_TOKEN"];
    expect(validateWsToken("admin-123", tokenStore)).toBe(true);
    expect(validateWsToken("wrong", tokenStore)).toBe(false);
    expect(validateWsToken(undefined, tokenStore)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Edge: GATEWAY_WS_TOKEN is set to empty string (treated as unset)
  // -------------------------------------------------------------------------

  it("falls back to tokenStore when GATEWAY_WS_TOKEN is empty string", () => {
    process.env["GATEWAY_WS_TOKEN"] = "";
    expect(validateWsToken("admin-123", tokenStore)).toBe(true);
    expect(validateWsToken("anything", tokenStore)).toBe(false);
  });
});
