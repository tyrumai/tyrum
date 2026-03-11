// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorUiHostApi } from "../../src/host/host-api.js";
import { canWriteTextToClipboard, writeTextToClipboard } from "../../src/utils/clipboard.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createMobileHost(writeText: (text: string) => Promise<void>): OperatorUiHostApi {
  return {
    kind: "mobile",
    api: {
      node: {
        getState: vi.fn(async () => ({
          platform: "ios",
          enabled: true,
          status: "connected",
          deviceId: "mobile-node-1",
          error: null,
          actions: {
            "location.get_current": {
              enabled: true,
              availabilityStatus: "ready",
              unavailableReason: null,
            },
            "camera.capture_photo": {
              enabled: true,
              availabilityStatus: "ready",
              unavailableReason: null,
            },
            "audio.record_clip": {
              enabled: true,
              availabilityStatus: "ready",
              unavailableReason: null,
            },
          },
        })),
        setEnabled: vi.fn(),
        setActionEnabled: vi.fn(),
      },
      clipboard: { writeText },
    },
  };
}

describe("clipboard utils", () => {
  it("uses the native mobile clipboard when provided by the host", async () => {
    const mobileWriteText = vi.fn(async () => {});
    const navigatorWriteText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: navigatorWriteText },
      configurable: true,
    });

    await writeTextToClipboard("mobile-only", createMobileHost(mobileWriteText));

    expect(mobileWriteText).toHaveBeenCalledWith("mobile-only");
    expect(navigatorWriteText).not.toHaveBeenCalled();
  });

  it("falls back to the browser clipboard when no host clipboard is available", async () => {
    const navigatorWriteText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: navigatorWriteText },
      configurable: true,
    });

    expect(canWriteTextToClipboard({ kind: "web" })).toBe(true);
    await writeTextToClipboard("browser-copy", { kind: "web" });

    expect(navigatorWriteText).toHaveBeenCalledWith("browser-copy");
  });
});
