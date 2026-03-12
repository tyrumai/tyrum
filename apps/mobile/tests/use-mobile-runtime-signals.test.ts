// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  addAppListenerMock,
  addNetworkListenerMock,
  appListeners,
  getStateMock,
  getStatusMock,
  isNativePlatformMock,
  networkListeners,
} = vi.hoisted(() => {
  const appListenersInner = new Map<string, (event: unknown) => void>();
  const networkListenersInner = new Map<string, (event: unknown) => void>();

  return {
    addAppListenerMock: vi.fn(async (event: string, listener: (event: unknown) => void) => {
      appListenersInner.set(event, listener);
      return {
        remove: vi.fn(async () => {
          appListenersInner.delete(event);
        }),
      };
    }),
    addNetworkListenerMock: vi.fn(async (event: string, listener: (event: unknown) => void) => {
      networkListenersInner.set(event, listener);
      return {
        remove: vi.fn(async () => {
          networkListenersInner.delete(event);
        }),
      };
    }),
    appListeners: appListenersInner,
    getStateMock: vi.fn(async () => ({ isActive: false })),
    getStatusMock: vi.fn(async () => ({ connected: false, connectionType: "none" })),
    isNativePlatformMock: vi.fn(() => true),
    networkListeners: networkListenersInner,
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: isNativePlatformMock,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: addAppListenerMock,
    getState: getStateMock,
  },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: addNetworkListenerMock,
    getStatus: getStatusMock,
  },
}));

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("useMobileRuntimeSignals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appListeners.clear();
    networkListeners.clear();
    isNativePlatformMock.mockReturnValue(true);
  });

  it("tracks app/network state and reconnects on foreground or network restore", async () => {
    const onReconnect = vi.fn();
    const { useMobileRuntimeSignals } = await import("../src/use-mobile-runtime-signals.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileRuntimeSignals> | null = null;
    const Probe = () => {
      latestState = useMobileRuntimeSignals(onReconnect);
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    expect(latestState?.appActive).toBe(false);
    expect(latestState?.networkStatus).toMatchObject({
      connected: false,
      connectionType: "none",
    });
    expect(onReconnect).not.toHaveBeenCalled();

    await act(async () => {
      appListeners.get("appStateChange")?.({ isActive: true });
      networkListeners.get("networkStatusChange")?.({ connected: true, connectionType: "wifi" });
      await flushMicrotasks();
    });

    expect(latestState?.appActive).toBe(true);
    expect(latestState?.networkStatus).toMatchObject({
      connected: true,
      connectionType: "wifi",
    });
    expect(onReconnect).toHaveBeenCalledTimes(2);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps native listeners stable while using the latest reconnect callback", async () => {
    const initialReconnect = vi.fn();
    const nextReconnect = vi.fn();
    const { useMobileRuntimeSignals } = await import("../src/use-mobile-runtime-signals.js");
    const { container, root } = createTestRoot();

    const Probe = ({ onReconnect }: { onReconnect: () => void }) => {
      useMobileRuntimeSignals(onReconnect);
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe, { onReconnect: initialReconnect }));
      await flushMicrotasks();
    });

    expect(addAppListenerMock).toHaveBeenCalledTimes(1);
    expect(addNetworkListenerMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(React.createElement(Probe, { onReconnect: nextReconnect }));
      await flushMicrotasks();
    });

    expect(addAppListenerMock).toHaveBeenCalledTimes(1);
    expect(addNetworkListenerMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      appListeners.get("appStateChange")?.({ isActive: true });
      networkListeners.get("networkStatusChange")?.({ connected: true, connectionType: "wifi" });
      await flushMicrotasks();
    });

    expect(initialReconnect).not.toHaveBeenCalled();
    expect(nextReconnect).toHaveBeenCalledTimes(2);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
