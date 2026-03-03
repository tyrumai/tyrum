// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — operator-core
// ---------------------------------------------------------------------------

const { createOperatorCoreManagerMock, testState, notifyConnectionChange } = vi.hoisted(() => {
  const testState = {
    coreStatus: "connected" as CoreStatus,
  };

  const subscribers = new Set<() => void>();
  const connectionStore = {
    getSnapshot: () => ({ status: testState.coreStatus }),
    subscribe: vi.fn((onStoreChange: () => void) => {
      subscribers.add(onStoreChange);
      return () => {
        subscribers.delete(onStoreChange);
      };
    }),
  };
  const coreInstance = { connect: vi.fn(), connectionStore };

  const notifyConnectionChange = (): void => {
    for (const cb of subscribers) {
      cb();
    }
  };

  const createOperatorCoreManagerMock = vi.fn(
    (input: {
      wsUrl: string;
      httpBaseUrl: string;
      baselineAuth: unknown;
      elevatedModeStore: unknown;
      createCore: (opts: unknown) => unknown;
    }) => {
      input.createCore({
        wsUrl: input.wsUrl,
        httpBaseUrl: input.httpBaseUrl,
        auth: input.baselineAuth,
        elevatedModeStore: input.elevatedModeStore,
      });
      return {
        getCore: () => coreInstance,
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
      };
    },
  );

  return { createOperatorCoreManagerMock, testState, notifyConnectionChange };
});

vi.mock("@tyrum/client", () => ({
  createTyrumHttpClient: vi.fn(() => ({})),
}));

vi.mock("@tyrum/operator-core", () => ({
  createBearerTokenAuth: vi.fn((token: string) => ({ type: "bearer-token", token })),
  createElevatedModeStore: vi.fn(() => ({ dispose: vi.fn() })),
  createOperatorCore: vi.fn((opts: unknown) => opts),
  createOperatorCoreManager: createOperatorCoreManagerMock,
  httpAuthForAuth: vi.fn((auth: unknown) => auth),
  deviceIdFromSha256Digest: vi.fn((fingerprint: string) => `device-${fingerprint}`),
  createTyrumHttpClient: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Mocks — operator-ui (keep real layout, mock pages + providers)
// ---------------------------------------------------------------------------

vi.mock("@tyrum/operator-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tyrum/operator-ui")>();
  return {
    ...actual,
    ApprovalsPage: () => createElement("div", { "data-testid": "page-approvals" }),
    RunsPage: () => createElement("div", { "data-testid": "page-runs" }),
    PairingPage: () => createElement("div", { "data-testid": "page-pairing" }),
    MemoryPage: () => createElement("div", { "data-testid": "page-memory" }),
    SettingsPage: () => createElement("div", { "data-testid": "page-settings" }),
    ConnectPage: () => createElement("div", { "data-testid": "operator-connect" }),
    ElevatedModeProvider: ({ children }: { children: unknown }) => children,
    ToastProvider: ({ children }: { children: unknown }) => children,
  };
});

// ---------------------------------------------------------------------------
// Mocks — desktop page components
// ---------------------------------------------------------------------------

vi.mock("../src/renderer/pages/Dashboard.js", () => ({
  Dashboard: () => createElement("div", { "data-testid": "page-dashboard" }),
}));
vi.mock("../src/renderer/pages/ConnectionPage.js", () => ({
  ConnectionPage: () => createElement("div", { "data-testid": "page-connection" }),
}));
vi.mock("../src/renderer/pages/DebugPage.js", () => ({
  DebugPage: () => createElement("div", { "data-testid": "page-debug" }),
}));
vi.mock("../src/renderer/pages/Permissions.js", () => ({
  Permissions: () => createElement("div", { "data-testid": "page-permissions" }),
}));
vi.mock("../src/renderer/pages/WorkBoard.js", () => ({
  WorkBoard: () => createElement("div", { "data-testid": "page-work" }),
}));
vi.mock("../src/renderer/components/ConsentModal.js", () => ({
  ConsentModal: () => null,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App page routing", () => {
  let root: Root;
  let navCallback: ((req: unknown) => void) | null = null;
  let deepLinkCallback: ((url: string) => void) | null = null;
  let pendingDeepLinkUrl: string | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    navCallback = null;
    deepLinkCallback = null;
    pendingDeepLinkUrl = null;
    vi.clearAllMocks();
    testState.coreStatus = "connected";

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      configExists: vi.fn(async () => true),
      getConfig: vi.fn(async () => ({ mode: "remote" })),
      gateway: {
        getOperatorConnection: vi.fn(async () => ({
          mode: "remote",
          wsUrl: "ws://example",
          httpBaseUrl: "http://example",
          token: "tok",
          tlsCertFingerprint256: "fp",
        })),
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        httpFetch: vi.fn(async () => ({
          status: 200,
          headers: {},
          bodyText: "ok",
        })),
      },
      onStatusChange: vi.fn(() => () => {}),
      onNavigationRequest: vi.fn((cb: (req: unknown) => void) => {
        navCallback = cb;
        return () => {};
      }),
      consumeDeepLink: vi.fn(async () => {
        const url = pendingDeepLinkUrl;
        pendingDeepLinkUrl = null;
        return url;
      }),
      onDeepLinkOpen: vi.fn((cb: (url: string) => void) => {
        deepLinkCallback = cb;
        return () => {};
      }),
    };

    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root")!);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  async function renderApp(): Promise<void> {
    const { App } = await import("../src/renderer/App.js");
    await act(async () => {
      root.render(createElement(App));
    });
    // Allow operator core boot
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function navigateTo(pageId: string): Promise<void> {
    await act(async () => {
      navCallback!({ pageId });
    });
    // Let effects settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("navigates to every page via onNavigationRequest", async () => {
    await renderApp();

    // Dashboard is the default page
    expect(document.querySelector('[data-testid="page-dashboard"]')).not.toBeNull();

    // Navigate to each operator page while core is available
    for (const page of ["approvals", "runs", "memory", "pairing", "settings"]) {
      await navigateTo(page);
      expect(
        document.querySelector(`[data-testid="page-${page}"]`),
        `expected page-${page} to render`,
      ).not.toBeNull();
    }

    // Non-operator pages and connection (doesn't use OperatorPageGuard)
    for (const page of ["connection", "work", "permissions", "debug"]) {
      await navigateTo(page);
      expect(
        document.querySelector(`[data-testid="page-${page}"]`),
        `expected page-${page} to render`,
      ).not.toBeNull();
    }
  });

  it("resolves legacy page aliases", async () => {
    await renderApp();

    await navigateTo("gateway");
    expect(document.querySelector('[data-testid="page-dashboard"]')).not.toBeNull();

    await navigateTo("overview");
    expect(document.querySelector('[data-testid="page-dashboard"]')).not.toBeNull();

    await navigateTo("diagnostics");
    expect(document.querySelector('[data-testid="page-debug"]')).not.toBeNull();

    await navigateTo("logs");
    expect(document.querySelector('[data-testid="page-debug"]')).not.toBeNull();
  });

  it("blocks navigation to non-connection pages when remote mode is not connected", async () => {
    testState.coreStatus = "disconnected";
    await renderApp();

    expect(document.querySelector('[data-testid="page-connection"]')).not.toBeNull();

    await navigateTo("runs");
    expect(document.querySelector('[data-testid="page-connection"]')).not.toBeNull();
  });

  it("queues deep links while setup gate is active and replays after connection succeeds", async () => {
    testState.coreStatus = "disconnected";
    await renderApp();

    expect(document.querySelector('[data-testid="page-connection"]')).not.toBeNull();

    pendingDeepLinkUrl = "tyrum://work?work_item_id=w-1";
    await act(async () => {
      deepLinkCallback?.("tyrum://work?work_item_id=w-1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="page-work"]')).toBeNull();

    await act(async () => {
      testState.coreStatus = "connected";
      notifyConnectionChange();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="page-work"]')).not.toBeNull();
  });
});
