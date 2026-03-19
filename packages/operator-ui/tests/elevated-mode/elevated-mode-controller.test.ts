import { describe, expect, it, vi } from "vitest";
import { createElevatedModeStore } from "../../../operator-app/src/stores/elevated-mode-store.js";
import {
  ADMIN_ACCESS_TTL_SECONDS,
  ELEVATED_MODE_SCOPES,
  createPersistentElevatedModeController,
} from "../../src/components/elevated-mode/elevated-mode-controller.js";

function createFakeHttp() {
  return {
    deviceTokens: {
      issue: vi.fn(async () => ({
        token: "elevated-device-token",
        expires_at: "2099-01-01T00:00:00.000Z",
      })),
      revoke: vi.fn(async () => {}),
    },
  };
}

describe("createPersistentElevatedModeController", () => {
  it("exports expected scope list and TTL", () => {
    expect(ELEVATED_MODE_SCOPES).toContain("operator.read");
    expect(ELEVATED_MODE_SCOPES).toContain("operator.write");
    expect(ELEVATED_MODE_SCOPES).toContain("operator.admin");
    expect(ELEVATED_MODE_SCOPES).toContain("operator.approvals");
    expect(ELEVATED_MODE_SCOPES).toContain("operator.pairing");
    expect(ADMIN_ACCESS_TTL_SECONDS).toBe(600);
  });

  it("enter issues a device token and activates the store", async () => {
    const http = createFakeHttp();
    const store = createElevatedModeStore();
    const controller = createPersistentElevatedModeController({
      http: http as never,
      deviceId: "test-device",
      elevatedModeStore: store,
    });

    await controller.enter();

    expect(http.deviceTokens.issue).toHaveBeenCalledWith({
      device_id: "test-device",
      role: "client",
      scopes: [...ELEVATED_MODE_SCOPES],
      ttl_seconds: ADMIN_ACCESS_TTL_SECONDS,
    });
    expect(store.getSnapshot().status).toBe("active");
    expect(store.getSnapshot().elevatedToken).toBe("elevated-device-token");
    store.dispose();
  });

  it("enter throws when gateway returns no expires_at", async () => {
    const http = createFakeHttp();
    http.deviceTokens.issue.mockResolvedValueOnce({ token: "tok", expires_at: null });
    const store = createElevatedModeStore();
    const controller = createPersistentElevatedModeController({
      http: http as never,
      deviceId: "test-device",
      elevatedModeStore: store,
    });

    await expect(controller.enter()).rejects.toThrow("without an expiration");
    expect(store.getSnapshot().status).toBe("inactive");
    store.dispose();
  });

  it("exit revokes the token and deactivates the store", async () => {
    const http = createFakeHttp();
    const store = createElevatedModeStore();
    store.enter({ elevatedToken: "tok-to-revoke", expiresAt: "2099-01-01T00:00:00.000Z" });

    const controller = createPersistentElevatedModeController({
      http: http as never,
      deviceId: "test-device",
      elevatedModeStore: store,
    });

    await controller.exit();

    expect(http.deviceTokens.revoke).toHaveBeenCalledWith({ token: "tok-to-revoke" });
    expect(store.getSnapshot().status).toBe("inactive");
    store.dispose();
  });

  it("exit without active token exits store without revocation", async () => {
    const http = createFakeHttp();
    const store = createElevatedModeStore();

    const controller = createPersistentElevatedModeController({
      http: http as never,
      deviceId: "test-device",
      elevatedModeStore: store,
    });

    await controller.exit();

    expect(http.deviceTokens.revoke).not.toHaveBeenCalled();
    expect(store.getSnapshot().status).toBe("inactive");
    store.dispose();
  });
});
