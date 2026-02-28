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
    (input: { baseUrl: string; fetch?: (input: RequestInfo, init?: RequestInit) => Promise<unknown> }) => {
      ipcFetchPromise =
        input.fetch?.(`${input.baseUrl.replace(/\/$/, "")}/healthz`, {
          method: "GET",
          headers: { "x-test": "1" },
        }) ?? null;
      return {};
    },
  );

  const createOperatorCoreMock = vi.fn(() => ({
    connect: coreConnectMock,
  }));

  const createOperatorCoreManagerMock = vi.fn((input: {
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
  });

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
}));

vi.mock("@tyrum/operator-ui", () => ({
  OperatorUiApp: () => createElement("div", { "data-testid": "operator-ui-app" }),
  MemoryInspector: () => createElement("div", { "data-testid": "memory-inspector" }),
}));

vi.mock("../src/renderer/pages/Overview.js", () => ({
  Overview: () => null,
}));

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
        httpFetch,
      },
    };

    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById("root")!;

    const { App } = await import("../src/renderer/App.js");

    const root: Root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
    });

    const clickNavByLabel = (label: string): void => {
      const buttons = Array.from(document.querySelectorAll('[role="button"]')) as HTMLElement[];
      const target = buttons.find((el) => el.textContent?.trim() === label);
      if (!target) {
        throw new Error(`nav item not found: ${label}`);
      }
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    await act(async () => {
      clickNavByLabel("Memory");
    });

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

    await act(async () => {
      clickNavByLabel("Gateway");
    });

    await act(async () => {
      root.unmount();
    });
  });
});
