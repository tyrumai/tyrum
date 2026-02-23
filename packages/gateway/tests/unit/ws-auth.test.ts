/**
 * Unit tests for WebSocket token authentication.
 *
 * Validates that `authenticateWsToken` requires the gateway token store.
 */

import { describe, expect, it } from "vitest";
import { authenticateWsToken } from "../../src/ws/auth.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("authenticateWsToken", () => {
  const mockedTokenStore = {
    authenticate(candidate: string) {
      return candidate === "admin-123" ? ({ token_kind: "admin" } as const) : null;
    },
  } as unknown as TokenStore;

  it("returns null when tokenStore is missing", () => {
    expect(authenticateWsToken("admin-123")).toBeNull();
  });

  it("validates against tokenStore", () => {
    expect(authenticateWsToken("admin-123", mockedTokenStore)).toEqual({ token_kind: "admin" });
    expect(authenticateWsToken("wrong", mockedTokenStore)).toBeNull();
    expect(authenticateWsToken(undefined, mockedTokenStore)).toBeNull();
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
      expect(authenticateWsToken(issued.token, tokenStore)).not.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
