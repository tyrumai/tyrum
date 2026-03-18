// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileConnectionConfig } from "../src/mobile-config.js";
import { createManagedNodeClientLifecycleMock } from "../../../packages/client/tests/managed-node-client.test-support.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  clientInstances,
  MockTyrumClient,
  connectMock,
  deviceInfoMock,
  disconnectMock,
  isNativePlatformMock,
  loadOrCreateDeviceIdentityMock,
  locationStreamStartMock,
  locationStreamStopMock,
  updateConfigMock,
} = vi.hoisted(() => {
  const clientInstancesInner: MockTyrumClientInner[] = [];
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
  const loadOrCreateDeviceIdentityMockInner = vi.fn(async () => ({
    deviceId: "mobile-node-device-1",
    publicKey: "public",
    privateKey: "private",
  }));
  const locationStreamStartMockInner = vi.fn(async () => {});
  const locationStreamStopMockInner = vi.fn(async () => {});

  class MockTyrumClientInner {
    private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();
    readonly capabilityReady = vi.fn(async () => {});

    constructor(_options: unknown) {
      clientInstancesInner.push(this);
    }

    connect(): void {
      connectMockInner();
      queueMicrotask(() => {
        this.emit("connected");
      });
    }

    disconnect(): void {
      disconnectMockInner();
    }

    on(event: string, listener: (event?: unknown) => void): void {
      const listeners = this.listeners.get(event) ?? new Set<(event?: unknown) => void>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
    }

    off(event: string, listener: (event?: unknown) => void): void {
      this.listeners.get(event)?.delete(listener);
    }

    emit(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  }

  return {
    clientInstances: clientInstancesInner,
    MockTyrumClient: MockTyrumClientInner,
    connectMock: connectMockInner,
    deviceInfoMock: deviceInfoMockInner,
    disconnectMock: disconnectMockInner,
    isNativePlatformMock: isNativePlatformMockInner,
    loadOrCreateDeviceIdentityMock: loadOrCreateDeviceIdentityMockInner,
    locationStreamStartMock: locationStreamStartMockInner,
    locationStreamStopMock: locationStreamStopMockInner,
    updateConfigMock: vi.fn(async () => null),
  };
});

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

vi.mock("@capacitor/clipboard", () => ({
  Clipboard: {
    write: vi.fn(async () => {}),
  },
}));

vi.mock("@tyrum/client/browser", () => ({
  createManagedNodeClientLifecycle: createManagedNodeClientLifecycleMock(),
  formatDeviceIdentityError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  loadOrCreateDeviceIdentity: loadOrCreateDeviceIdentityMock,
  TyrumClient: MockTyrumClient,
}));

vi.mock("../src/mobile-capability-provider.js", () => ({
  createMobileCapabilityProvider: vi.fn(() => ({ kind: "mock-provider" })),
}));

vi.mock("../src/mobile-location-stream.js", () => ({
  createMobileLocationBeaconStream: vi.fn(() => ({
    start: locationStreamStartMock,
    stop: locationStreamStopMock,
  })),
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

describe("useMobileNode lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    isNativePlatformMock.mockReturnValue(true);
  });

  it("updates state on transport errors and disconnects without reconnecting", async () => {
    const { useMobileNode } = await import("../src/use-mobile-node.js");
    const { container, root } = createTestRoot();

    const config: MobileConnectionConfig = {
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      nodeEnabled: true,
      actionSettings: {
        get: true,
        capture_photo: true,
        record: true,
      },
      locationStreaming: {
        streamEnabled: true,
        distanceFilterM: 100,
        maxIntervalMs: 900_000,
        maxAccuracyM: 100,
        backgroundEnabled: true,
      },
    };

    let latestState: ReturnType<typeof useMobileNode>["state"] | null = null;

    const Probe = () => {
      const result = useMobileNode({
        config,
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

    const client = clientInstances.at(0);
    expect(client).toBeDefined();
    expect(latestState?.status).toBe("connected");
    expect(locationStreamStartMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      client?.emit("transport_error", { message: "socket failed" });
      await flushMicrotasks();
    });

    expect(latestState?.error).toBe("socket failed");
    expect(connectMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      client?.emit("disconnected");
      await flushMicrotasks();
    });

    expect(latestState?.status).toBe("disconnected");
    expect(locationStreamStopMock).toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not create a device identity after the effect is disposed during device info load", async () => {
    const { useMobileNode } = await import("../src/use-mobile-node.js");
    const { container, root } = createTestRoot();
    const deferredDeviceInfo = createDeferred<{
      name: string;
      manufacturer: string;
      model: string;
      operatingSystem: string;
      osVersion: string;
    }>();
    deviceInfoMock.mockImplementationOnce(() => deferredDeviceInfo.promise);

    const config: MobileConnectionConfig = {
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      nodeEnabled: true,
      actionSettings: {
        get: true,
        capture_photo: true,
        record: true,
      },
      locationStreaming: {
        streamEnabled: true,
        distanceFilterM: 100,
        maxIntervalMs: 900_000,
        maxAccuracyM: 100,
        backgroundEnabled: true,
      },
    };

    const Probe = () => {
      useMobileNode({
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

    act(() => {
      root.unmount();
    });

    expect(connectMock).not.toHaveBeenCalled();
    await act(async () => {
      deferredDeviceInfo.resolve({
        name: "Ron phone",
        manufacturer: "Virtunet",
        model: "Ty-Phone",
        operatingSystem: "ios",
        osVersion: "18.1",
      });
      await flushMicrotasks();
    });

    expect(loadOrCreateDeviceIdentityMock).not.toHaveBeenCalled();
    container.remove();
  });
});
