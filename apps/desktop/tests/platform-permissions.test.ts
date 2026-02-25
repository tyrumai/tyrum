import Module from "node:module";
import { describe, it, expect, vi } from "vitest";
import { checkMacPermissions, requestMacPermission } from "../src/main/platform/permissions.js";

async function withMockedDarwinElectron<T>(
  electronMock: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const originalPlatform = process.platform;
  const originalRequire = Module.prototype.require;

  Object.defineProperty(process, "platform", {
    value: "darwin",
    writable: true,
  });

  Module.prototype.require = function patchedRequire(this: unknown, id: string) {
    if (id === "electron") {
      return electronMock;
    }
    return originalRequire.call(this as object, id);
  };

  try {
    return await run();
  } finally {
    Module.prototype.require = originalRequire;
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  }
}

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

  it("prompts accessibility permission on macOS and returns granted", async () => {
    const isTrustedAccessibilityClient = vi.fn(() => true);
    await withMockedDarwinElectron(
      {
        systemPreferences: {
          isTrustedAccessibilityClient,
          getMediaAccessStatus: () => "granted",
        },
        shell: { openExternal: vi.fn() },
      },
      async () => {
        const result = await requestMacPermission("accessibility");
        expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
        expect(result).toEqual({ granted: true, instructions: undefined });
      },
    );
  });

  it("opens Screen Recording settings when not granted on macOS", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    await withMockedDarwinElectron(
      {
        systemPreferences: {
          isTrustedAccessibilityClient: vi.fn(() => true),
          getMediaAccessStatus: vi.fn(() => "denied"),
        },
        shell: { openExternal },
      },
      async () => {
        const result = await requestMacPermission("screenRecording");
        expect(openExternal).toHaveBeenCalledWith(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
        expect(result.granted).toBe(false);
        expect(result.instructions).toContain("Opened Screen Recording settings");
      },
    );
  });
});
