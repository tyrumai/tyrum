// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CoreOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  auth: unknown;
  adminModeStore: unknown;
};

let ipcFetchPromise: Promise<unknown> | null = null;

const {
  createTyrumHttpClientMock,
  createOperatorCoreMock,
  createOperatorCoreManagerMock,
  coreConnectMock,
} = vi.hoisted(() => {
  const coreConnectMock = vi.fn();

  const createTyrumHttpClientMock = vi.fn(
    (input: {
      baseUrl: string;
      fetch?: (input: RequestInfo, init?: RequestInit) => Promise<unknown>;
    }) => {
      ipcFetchPromise =
        input.fetch?.(`${input.baseUrl.replace(/\/$/, "")}/healthz`, {
          method: "GET",
          headers: { "x-test": "1" },
        }) ?? null;
      return {};
    },
  );

  const connectionStore = {
    getSnapshot: () => ({ status: "disconnected" }),
    subscribe: vi.fn(() => () => {}),
  };

  const createOperatorCoreMock = vi.fn(() => ({
    connect: coreConnectMock,
    connectionStore,
  }));

  const createOperatorCoreManagerMock = vi.fn(
    (input: {
      wsUrl: string;
      httpBaseUrl: string;
      baselineAuth: unknown;
      adminModeStore: unknown;
      createCore: (options: CoreOptions) => unknown;
    }) => {
      const core = input.createCore({
        wsUrl: input.wsUrl,
        httpBaseUrl: input.httpBaseUrl,
        auth: input.baselineAuth,
        adminModeStore: input.adminModeStore,
      });

      const manager = {
        getCore: () => core,
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
      };

      return manager;
    },
  );

  return {
    createTyrumHttpClientMock,
    createOperatorCoreMock,
    createOperatorCoreManagerMock,
    coreConnectMock,
  };
});

vi.mock("@tyrum/client", () => ({
  createTyrumHttpClient: createTyrumHttpClientMock,
}));

vi.mock("@tyrum/operator-core", () => ({
  createAdminModeStore: vi.fn(() => ({ dispose: vi.fn() })),
  createBearerTokenAuth: vi.fn((token: string) => ({ type: "bearer-token", token })),
  createOperatorCore: createOperatorCoreMock,
  createOperatorCoreManager: createOperatorCoreManagerMock,
  httpAuthForAuth: vi.fn((auth: unknown) => auth),
  deviceIdFromSha256Digest: vi.fn((fingerprint: string) => `device-${fingerprint}`),
  createTyrumHttpClient: createTyrumHttpClientMock,
}));

vi.mock("@tyrum/operator-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tyrum/operator-ui")>();
  return {
    ...actual,
    OperatorUiApp: () => createElement("div", { "data-testid": "operator-ui-app" }),
    MemoryInspector: () => createElement("div", { "data-testid": "memory-inspector" }),
    DashboardPage: () => createElement("div", { "data-testid": "operator-dashboard" }),
    ApprovalsPage: () => createElement("div", { "data-testid": "operator-approvals" }),
    RunsPage: () => createElement("div", { "data-testid": "operator-runs" }),
    ConnectPage: () => createElement("div", { "data-testid": "operator-connect" }),
    PairingPage: () => createElement("div", { "data-testid": "operator-pairing" }),
    MemoryPage: () => createElement("div", { "data-testid": "operator-memory" }),
    SettingsPage: () => createElement("div", { "data-testid": "operator-settings" }),
    AdminModeProvider: ({ children }: { children: unknown }) => children,
    ToastProvider: ({ children }: { children: unknown }) => children,
  };
});

vi.mock("../src/renderer/components/ConsentModal.js", () => ({
  ConsentModal: () => null,
}));

describe("desktop operator-core diff line coverage", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    ipcFetchPromise = null;
    vi.clearAllMocks();
  });

  it("exercises App wiring and operator core boot path", async () => {
    const getOperatorConnection = vi.fn(async () => ({
      mode: "remote",
      wsUrl: "ws://example",
      httpBaseUrl: "http://example",
      token: "test-token",
      tlsCertFingerprint256: "test-fingerprint",
    }));

    const httpFetch = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      bodyText: "ok",
    }));

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      getConfig: vi.fn(async () => ({ mode: "remote" })),
      gateway: {
        getOperatorConnection,
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        httpFetch,
      },
      onStatusChange: vi.fn(() => () => {}),
    };

    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById("root")!;

    const { App } = await import("../src/renderer/App.js");

    const root: Root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });

    // Dashboard is the default page and it enables operator core
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    if (ipcFetchPromise) {
      await act(async () => {
        await ipcFetchPromise;
      });
    }

    expect(getOperatorConnection).toHaveBeenCalledTimes(1);
    expect(createOperatorCoreManagerMock).toHaveBeenCalledTimes(1);
    expect(coreConnectMock).toHaveBeenCalledTimes(1);

    // Navigate to a non-operator page to exercise the disable path
    const clickNavItem = (id: string): void => {
      const button = document.querySelector(`[data-testid="nav-${id}"]`);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`nav item not found: ${id}`);
      }
      button.click();
    };

    await act(async () => {
      clickNavItem("work");
    });

    await act(async () => {
      root.unmount();
    });
  });
});
