// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileConnectionConfig } from "../src/mobile-config.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  capturedClientOptions,
  MockTyrumClient,
  autoExecuteMock,
  clipboardWriteMock,
  connectMock,
  deviceInfoMock,
  disconnectMock,
  isNativePlatformMock,
  updateConfigMock,
} = vi.hoisted(() => {
  const capturedClientOptionsInner: unknown[] = [];
  const autoExecuteMockInner = vi.fn();
  const clipboardWriteMockInner = vi.fn(async () => {});
  const connectMockInner = vi.fn();
  const deviceInfoMockInner = vi.fn(async () => ({
    name: "Ron phone",
    manufacturer: "Virtunet",
    model: "Ty-Phone",
    operatingSystem: "ios",
    osVersion: "18.1",
  }));
  const disconnectMockInner = vi.fn();
  const isNativePlatformMockInner = vi.fn(() => true);

  class MockTyrumClientInner {
    private readonly listeners = new Map<string, Set<() => void>>();

    capabilityReady = vi.fn(async () => {});

    constructor(options: unknown) {
      capturedClientOptionsInner.push(options);
    }

    connect() {
      connectMockInner();
      queueMicrotask(() => {
        for (const listener of this.listeners.get("connected") ?? []) {
          listener();
        }
      });
    }

    disconnect() {
      disconnectMockInner();
    }

    on(event: string, listener: () => void) {
      const listeners = this.listeners.get(event) ?? new Set<() => void>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }

    off(event: string, listener: () => void) {
      this.listeners.get(event)?.delete(listener);
    }
  }

  return {
    capturedClientOptions: capturedClientOptionsInner,
    MockTyrumClient: MockTyrumClientInner,
    autoExecuteMock: autoExecuteMockInner,
    clipboardWriteMock: clipboardWriteMockInner,
    connectMock: connectMockInner,
    deviceInfoMock: deviceInfoMockInner,
    disconnectMock: disconnectMockInner,
    isNativePlatformMock: isNativePlatformMockInner,
    updateConfigMock: vi.fn(async () => null),
  };
});

vi.mock("@capacitor/clipboard", () => ({
  Clipboard: {
    write: clipboardWriteMock,
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "ios"),
    isNativePlatform: isNativePlatformMock,
  },
}));

vi.mock("@capacitor/device", () => ({
  Device: {
    getInfo: deviceInfoMock,
  },
}));

vi.mock("@tyrum/client/browser", () => ({
  autoExecute: autoExecuteMock,
  formatDeviceIdentityError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: "mobile-node-device-1",
    publicKey: "public",
    privateKey: "private",
  })),
  TyrumClient: MockTyrumClient,
}));

vi.mock("../src/mobile-capability-provider.js", () => ({
  createMobileCapabilityProvider: vi.fn(() => ({ kind: "mock-provider" })),
}));

vi.mock("../src/mobile-config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/mobile-config.js")>("../src/mobile-config.js");
  return {
    ...actual,
    createNodeIdentityStorage: vi.fn(() => ({})),
  };
});

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("useMobileNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedClientOptions.length = 0;
    isNativePlatformMock.mockReturnValue(true);
  });

  it("does not reconnect when rerenders rebuild an equivalent config object", async () => {
    const { useMobileNode } = await import("../src/use-mobile-node.js");
    const { container, root } = createTestRoot();

    const baseConfig: MobileConnectionConfig = {
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      nodeEnabled: true,
      actionSettings: {
        "location.get_current": true,
        "camera.capture_photo": true,
        "audio.record_clip": true,
      },
    };

    let latestState: ReturnType<typeof useMobileNode>["state"] | null = null;

    const Probe = () => {
      const result = useMobileNode({
        config: {
          ...baseConfig,
          actionSettings: { ...baseConfig.actionSettings },
        },
        token: "token-1",
        updateConfig: updateConfigMock,
      });
      latestState = result.state;
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(autoExecuteMock).toHaveBeenCalledTimes(1);
    expect(latestState?.status).toBe("connected");

    act(() => {
      root.unmount();
    });

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it("enriches the node descriptor with native device info and exposes clipboard writes", async () => {
    const { useMobileNode } = await import("../src/use-mobile-node.js");
    const { container, root } = createTestRoot();

    const config: MobileConnectionConfig = {
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      nodeEnabled: true,
      actionSettings: {
        "location.get_current": true,
        "camera.capture_photo": true,
        "audio.record_clip": true,
      },
    };

    let latestResult: ReturnType<typeof useMobileNode> | null = null;

    const Probe = () => {
      latestResult = useMobileNode({
        config,
        token: "token-1",
        updateConfig: updateConfigMock,
      });
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    const clientOptions = capturedClientOptions.at(0) as
      | {
          device?: {
            label?: string;
            platform?: string;
            version?: string;
          };
        }
      | undefined;

    expect(deviceInfoMock).toHaveBeenCalledTimes(1);
    expect(clientOptions?.device?.label).toBe("Tyrum Mobile (Ron phone)");
    expect(clientOptions?.device?.platform).toBe("ios");
    expect(clientOptions?.device?.version).toBe("18.1");

    await latestResult?.hostApi.clipboard?.writeText("hello from mobile");
    expect(clipboardWriteMock).toHaveBeenCalledWith({ string: "hello from mobile" });

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
