// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrapConfig } from "../src/mobile-config.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  connectMock,
  controller,
  createOperatorCoreManagerMock,
  loadConfigMock,
  managerDisposeMock,
  setBootstrapState,
  storeDisposeMock,
  updateConfigMock,
} = vi.hoisted(() => {
  let bootstrapState: MobileBootstrapConfig | null = null;

  const connectMockInner = vi.fn();
  const managerDisposeMockInner = vi.fn();
  const storeDisposeMockInner = vi.fn();
  const controllerInner = { enter: vi.fn(async () => {}), exit: vi.fn(async () => {}) };

  return {
    connectMock: connectMockInner,
    controller: controllerInner,
    createOperatorCoreManagerMock: vi.fn(() => ({
      getCore: vi.fn(() => ({ connect: connectMockInner })),
      subscribe: vi.fn(() => vi.fn()),
      dispose: managerDisposeMockInner,
    })),
    loadConfigMock: vi.fn(async () => bootstrapState),
    managerDisposeMock: managerDisposeMockInner,
    setBootstrapState(next: MobileBootstrapConfig | null) {
      bootstrapState = next;
    },
    storeDisposeMock: storeDisposeMockInner,
    updateConfigMock: vi.fn(
      async (current: MobileBootstrapConfig, next: Partial<MobileBootstrapConfig>) => {
        bootstrapState = {
          ...current,
          ...next,
          actionSettings: next.actionSettings
            ? { ...next.actionSettings }
            : { ...current.actionSettings },
          locationStreaming: next.locationStreaming
            ? { ...next.locationStreaming }
            : { ...current.locationStreaming },
        };
        return bootstrapState;
      },
    ),
  };
});

vi.mock("@tyrum/operator-core/browser", () => ({
  createBearerTokenAuth: vi.fn((token: string) => ({ type: "bearer", token })),
  createElevatedModeStore: vi.fn(() => ({ dispose: storeDisposeMock })),
  createOperatorCore: vi.fn(() => ({})),
  createOperatorCoreManager: createOperatorCoreManagerMock,
  createTyrumHttpClient: vi.fn(() => ({})),
  httpAuthForAuth: vi.fn((auth: unknown) => auth),
}));

vi.mock("@tyrum/operator-ui", () => ({
  createAdminAccessController: vi.fn(() => controller),
}));

vi.mock("@tyrum/client/browser", () => ({
  formatDeviceIdentityError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: "mobile-operator-device-1",
    publicKey: "public",
    privateKey: "private",
  })),
}));

vi.mock("../src/mobile-config.js", () => ({
  clearMobileBootstrapConfig: vi.fn(async () => {}),
  createOperatorIdentityStorage: vi.fn(() => ({})),
  loadMobileBootstrapConfig: loadConfigMock,
  saveMobileBootstrapConfig: vi.fn(async () => {}),
  updateMobileConnectionConfig: updateConfigMock,
}));

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

describe("useMobileOperatorCore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setBootstrapState({
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      token: "token-1",
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
    });
  });

  it("does not reconnect the operator core when only node settings change", async () => {
    const { useMobileOperatorCore } = await import("../src/use-mobile-operator-core.js");
    const { container, root } = createTestRoot();

    let state: ReturnType<typeof useMobileOperatorCore> | null = null;
    const Probe = () => {
      state = useMobileOperatorCore();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(createOperatorCoreManagerMock).toHaveBeenCalledTimes(1);
    expect(state?.bootstrap?.actionSettings["capture_photo"]).toBe(true);

    await act(async () => {
      await state?.updateConfig({
        nodeEnabled: false,
        actionSettings: {
          get: true,
          capture_photo: false,
          record: true,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(state?.bootstrap?.nodeEnabled).toBe(false);
    expect(state?.bootstrap?.actionSettings["capture_photo"]).toBe(false);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(createOperatorCoreManagerMock).toHaveBeenCalledTimes(1);
    expect(managerDisposeMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    expect(managerDisposeMock).toHaveBeenCalledTimes(1);
    expect(storeDisposeMock).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
