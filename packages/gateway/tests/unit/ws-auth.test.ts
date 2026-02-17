/**
 * Unit tests for WebSocket token authentication.
 *
 * Validates that `validateWsToken` correctly gates access based on the
 * `GATEWAY_WS_TOKEN` environment variable while remaining open in
 * dev/local mode (env var unset).
 */

import { afterEach, describe, expect, it } from "vitest";
import { validateWsToken } from "../../src/ws/auth.js";

// ---------------------------------------------------------------------------
// Save / restore process.env around each test
// ---------------------------------------------------------------------------

describe("validateWsToken", () => {
  const originalEnv = process.env["GATEWAY_WS_TOKEN"];

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

  // -------------------------------------------------------------------------
  // GATEWAY_WS_TOKEN is NOT set (dev / local mode)
  // -------------------------------------------------------------------------

  it("returns true when GATEWAY_WS_TOKEN is not set and token is undefined", () => {
    delete process.env["GATEWAY_WS_TOKEN"];
    expect(validateWsToken(undefined)).toBe(true);
  });

  it("returns true when GATEWAY_WS_TOKEN is not set and any token is supplied", () => {
    delete process.env["GATEWAY_WS_TOKEN"];
    expect(validateWsToken("any-value")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge: GATEWAY_WS_TOKEN is set to empty string (treated as unset)
  // -------------------------------------------------------------------------

  it("returns true when GATEWAY_WS_TOKEN is empty string (treated as unset)", () => {
    process.env["GATEWAY_WS_TOKEN"] = "";
    expect(validateWsToken(undefined)).toBe(true);
    expect(validateWsToken("anything")).toBe(true);
  });
});
