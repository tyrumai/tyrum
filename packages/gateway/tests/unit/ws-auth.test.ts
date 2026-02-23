/**
 * Unit tests for WebSocket token authentication.
 *
 * Validates that `validateWsToken` requires the gateway token store.
 */

import { describe, expect, it } from "vitest";
import { validateWsToken } from "../../src/ws/auth.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("validateWsToken", () => {
  const mockedTokenStore = {
    authenticate(candidate: string) {
      return candidate === "admin-123" ? ({ token_kind: "admin" } as const) : null;
    },
  } as unknown as TokenStore;

  it("returns false when tokenStore is missing", () => {
    expect(validateWsToken("admin-123")).toBe(false);
  });

  it("validates against tokenStore", () => {
    expect(validateWsToken("admin-123", mockedTokenStore)).toBe(true);
    expect(validateWsToken("wrong", mockedTokenStore)).toBe(false);
    expect(validateWsToken(undefined, mockedTokenStore)).toBe(false);
  });

  it("accepts device tokens for websocket upgrade auth", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "tyrum-ws-auth-test-"));
    try {
      const tokenStore = new TokenStore(tempDir);
      await tokenStore.initialize();
      const issued = await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 300,
      });

      expect(tokenStore.authenticate(issued.token)).not.toBeNull();
      expect(validateWsToken(issued.token, tokenStore)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
