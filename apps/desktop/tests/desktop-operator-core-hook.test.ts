// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopOperatorCoreState } from "../src/renderer/lib/desktop-operator-core.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  connectMock,
  controller,
  createDeviceIdentityMock,
  createElevatedModeStoreMock,
  createOperatorCoreManagerMock,
  createAdminAccessControllerMock,
  createTyrumHttpClientMock,
  gatewayGetOperatorConnectionMock,
  managerDisposeMock,
  retryingConnectionMock,
  storeDisposeMock,
} = vi.hoisted(() => {
  const connectMockInner = vi.fn();
  const controllerInner = { enter: vi.fn(async () => {}), exit: vi.fn(async () => {}) };
  const unsubscribeMockInner = vi.fn();
  const managerDisposeMockInner = vi.fn();
  const managerSubscribeMockInner = vi.fn(() => unsubscribeMockInner);
  const gatewayGetOperatorConnectionMockInner = vi.fn();
  const retryingConnectionMockInner = vi.fn();

  const createDeviceIdentityMockInner = vi.fn(async () => ({
    deviceId: "desktop-device-1",
    publicKey: "public",
    privateKey: "private",
  }));
  const storeDisposeMockInner = vi.fn();
  const createElevatedModeStoreMockInner = vi.fn(() => ({ dispose: storeDisposeMockInner }));
  const createTyrumHttpClientMockInner = vi.fn(() => ({}));
  const createOperatorCoreManagerMockInner = vi.fn(() => ({
    getCore: vi.fn(() => ({ connect: connectMockInner })),
    subscribe: managerSubscribeMockInner,
    dispose: managerDisposeMockInner,
  }));
  const createAdminAccessControllerMockInner = vi.fn(() => controllerInner);

  return {
    connectMock: connectMockInner,
    controller: controllerInner,
    createAdminAccessControllerMock: createAdminAccessControllerMockInner,
    createDeviceIdentityMock: createDeviceIdentityMockInner,
    createElevatedModeStoreMock: createElevatedModeStoreMockInner,
    createOperatorCoreManagerMock: createOperatorCoreManagerMockInner,
    createTyrumHttpClientMock: createTyrumHttpClientMockInner,
    gatewayGetOperatorConnectionMock: gatewayGetOperatorConnectionMockInner,
    managerDisposeMock: managerDisposeMockInner,
    retryingConnectionMock: retryingConnectionMockInner,
    storeDisposeMock: storeDisposeMockInner,
  };
});

vi.mock("@tyrum/operator-app", () => ({
  createBearerTokenAuth: vi.fn((token: string) => ({ type: "bearer", token })),
  createElevatedModeStore: createElevatedModeStoreMock,
  createOperatorCore: vi.fn(() => ({})),
  createOperatorCoreManager: createOperatorCoreManagerMock,
  httpAuthForAuth: vi.fn((auth: unknown) => auth),
}));

vi.mock("@tyrum/transport-sdk/browser", () => ({
  createDeviceIdentity: createDeviceIdentityMock,
  createTyrumHttpClient: createTyrumHttpClientMock,
}));

vi.mock("@tyrum/operator-ui", () => ({
  createAdminAccessController: createAdminAccessControllerMock,
}));

function createDesktopApi() {
  return {
    configExists: vi.fn(async () => true),
    gateway: {
      getOperatorConnection: gatewayGetOperatorConnectionMock,
    },
    httpFetch: vi.fn(async () => ({
      bodyText: "",
      status: 200,
      headers: {},
    })),
  };
}

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

describe("useDesktopOperatorCore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    gatewayGetOperatorConnectionMock.mockResolvedValue({
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      token: "desktop-token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    });
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = createDesktopApi();
  });

  it("connects the manager core during initial boot", async () => {
    const { useDesktopOperatorCore } = await import("../src/renderer/lib/desktop-operator-core.js");
    const { container, root } = createTestRoot();

    let state: DesktopOperatorCoreState | null = null;
    const Probe = () => {
      state = useDesktopOperatorCore();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(state?.core).not.toBeNull();
    expect(state?.adminAccessController).toBe(controller);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("retries boot after a failure when retry() is invoked", async () => {
    const desktopApi = (window as unknown as { tyrumDesktop: ReturnType<typeof createDesktopApi> })
      .tyrumDesktop;
    desktopApi.gateway.getOperatorConnection = retryingConnectionMock;
    retryingConnectionMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      token: "desktop-token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    });

    const { useDesktopOperatorCore } = await import("../src/renderer/lib/desktop-operator-core.js");
    const { container, root } = createTestRoot();

    let state: DesktopOperatorCoreState | null = null;
    const Probe = () => {
      state = useDesktopOperatorCore();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state?.errorMessage).toBe("boom");
    expect(connectMock).toHaveBeenCalledTimes(0);

    await act(async () => {
      state?.retry();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(retryingConnectionMock).toHaveBeenCalledTimes(2);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(state?.errorMessage).toBeNull();
    expect(state?.core).not.toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("disposes the fresh manager and store when controller creation throws", async () => {
    createAdminAccessControllerMock.mockImplementationOnce(() => {
      throw new Error("controller boom");
    });

    const { useDesktopOperatorCore } = await import("../src/renderer/lib/desktop-operator-core.js");
    const { container, root } = createTestRoot();

    let state: DesktopOperatorCoreState | null = null;
    const Probe = () => {
      state = useDesktopOperatorCore();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(managerDisposeMock).toHaveBeenCalledTimes(1);
    expect(storeDisposeMock).toHaveBeenCalledTimes(1);
    expect(state?.errorMessage).toBe("controller boom");
    expect(state?.core).toBeNull();
    expect(state?.adminAccessController).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
