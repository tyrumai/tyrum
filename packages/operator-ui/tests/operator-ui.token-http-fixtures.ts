import { vi } from "vitest";
import { TEST_DEVICE_IDENTITY } from "./operator-ui.test-support.js";

export function createAuthTokenHttpFixtures() {
  const authTokensList = vi.fn(async () => ({
    tokens: [
      {
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Tyrum",
        role: "client" as const,
        device_id: TEST_DEVICE_IDENTITY.deviceId,
        scopes: ["operator.read"],
        issued_at: "2026-02-27T00:00:00.000Z",
        expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: null,
        created_at: "2026-02-27T00:00:00.000Z",
        updated_at: "2026-02-27T00:00:00.000Z",
      },
    ],
  }));
  const authTokensIssue = vi.fn(async () => ({
    token: "tyrum-token.v1.token-id.secret",
    token_id: "token-1",
    tenant_id: "11111111-1111-4111-8111-111111111111",
    display_name: "Tyrum",
    device_id: TEST_DEVICE_IDENTITY.deviceId,
    role: "client" as const,
    scopes: [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ],
    issued_at: "2026-02-27T00:00:00.000Z",
    updated_at: "2026-02-27T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  }));
  const authTokensUpdate = vi.fn(async () => ({
    token: {
      token_id: "token-1",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Updated Tyrum",
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client" as const,
      scopes: ["operator.read", "operator.write"],
      issued_at: "2026-02-27T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
      created_at: "2026-02-27T00:00:00.000Z",
      updated_at: "2026-02-28T00:00:00.000Z",
    },
  }));
  const authTokensRevoke = vi.fn(async () => ({ revoked: true, token_id: "token-1" }));

  return {
    authTokensList,
    authTokensIssue,
    authTokensUpdate,
    authTokensRevoke,
  };
}

export function createDeviceTokenHttpFixtures() {
  const deviceTokensIssue = vi.fn(async () => ({
    token_kind: "device" as const,
    token: "elevated-device-token",
    token_id: "token-1",
    device_id: TEST_DEVICE_IDENTITY.deviceId,
    role: "client" as const,
    scopes: [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ],
    issued_at: "2026-02-27T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  }));
  const deviceTokensRevoke = vi.fn(async () => ({ revoked: true }));

  return {
    deviceTokensIssue,
    deviceTokensRevoke,
  };
}
