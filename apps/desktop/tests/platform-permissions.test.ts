import Module from "node:module";
import { describe, it, expect } from "vitest";
import {
  checkMacPermissions,
  requestMacPermission,
} from "../src/main/platform/permissions.js";

describe("checkMacPermissions", () => {
  it("returns both true on non-darwin platforms", () => {
    // We're running on Linux in CI, so this should work directly
    if (process.platform !== "darwin") {
      const result = checkMacPermissions();
      expect(result.accessibility).toBe(true);
      expect(result.screenRecording).toBe(true);
      expect(result.instructions).toBeUndefined();
    }
  });

  it("returns null for both when Electron is unavailable on darwin", () => {
    // Simulate darwin by testing the electron-not-available path
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });

    try {
      const result = checkMacPermissions();
      // require("electron") will fail in test context -> null
      expect(result.accessibility).toBeNull();
      expect(result.screenRecording).toBeNull();
      expect(result.instructions).toBeDefined();
      expect(result.instructions).toContain("not running in Electron");
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true,
      });
    }
  });

  it("returns the correct MacPermissions shape", () => {
    const result = checkMacPermissions();
    expect(result).toHaveProperty("accessibility");
    expect(result).toHaveProperty("screenRecording");
    // accessibility is boolean or null
    expect([true, false, null]).toContain(result.accessibility);
    expect([true, false, null]).toContain(result.screenRecording);
  });

  it("omits instructions when all macOS permissions are granted", () => {
    const originalPlatform = process.platform;
    const originalRequire = Module.prototype.require;

    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });

    Module.prototype.require = function patchedRequire(this: unknown, id: string) {
      if (id === "electron") {
        return {
          systemPreferences: {
            isTrustedAccessibilityClient: () => true,
            getMediaAccessStatus: () => "granted",
          },
        };
      }

      return originalRequire.call(this as object, id);
    };

    try {
      const result = checkMacPermissions();
      expect(result).toEqual({
        accessibility: true,
        screenRecording: true,
      });
      expect("instructions" in result).toBe(false);
    } finally {
      Module.prototype.require = originalRequire;
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        writable: true,
      });
    }
  });
});

describe("requestMacPermission", () => {
  it("returns granted on non-darwin platforms without prompting", async () => {
    if (process.platform !== "darwin") {
      const result = await requestMacPermission("accessibility");
      expect(result.granted).toBe(true);
      expect(result.instructions).toBeUndefined();
    }
  });

  it("returns known shape", async () => {
    const result = await requestMacPermission("screenRecording");
    expect(result).toHaveProperty("granted");
    expect(typeof result.granted).toBe("boolean");
    expect(result).toHaveProperty("instructions");
  });
});
