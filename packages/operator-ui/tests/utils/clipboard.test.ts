// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import type { OperatorUiHostApi } from "../../src/host/host-api.js";
import {
  canWriteTextToClipboard,
  useClipboard,
  writeTextToClipboard,
} from "../../src/utils/clipboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
            get: {
              enabled: true,
              availabilityStatus: "ready",
              unavailableReason: null,
            },
            capture_photo: {
              enabled: true,
              availabilityStatus: "ready",
              unavailableReason: null,
            },
            record: {
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

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
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

  it("recomputes canWrite on rerender when browser clipboard support appears later", async () => {
    const host = { kind: "web" } as const;
    const { container, root } = createTestRoot();

    let latestClipboard: ReturnType<typeof useClipboard> | null = null;
    let triggerRerender: (() => void) | null = null;

    const Probe = () => {
      latestClipboard = useClipboard();
      return null;
    };

    const Harness = () => {
      const [, setTick] = useState(0);
      triggerRerender = () => {
        setTick((value) => value + 1);
      };

      return React.createElement(
        OperatorUiHostProvider,
        { value: host },
        React.createElement(Probe),
      );
    };

    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    await act(async () => {
      root.render(React.createElement(Harness));
      await Promise.resolve();
    });

    expect(latestClipboard?.canWrite).toBe(false);

    const navigatorWriteText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: navigatorWriteText },
      configurable: true,
    });

    await act(async () => {
      triggerRerender?.();
      await Promise.resolve();
    });

    expect(latestClipboard?.canWrite).toBe(true);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
