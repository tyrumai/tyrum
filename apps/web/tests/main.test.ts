// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tyrum/operator-core", () => ({
  createBearerTokenAuth: vi.fn(),
  createBrowserCookieAuth: vi.fn(),
  createElevatedModeStore: vi.fn(),
  createGatewayAuthSession: vi.fn(),
  createOperatorCoreManager: vi.fn(),
}));

vi.mock("@tyrum/operator-ui", () => ({
  OperatorUiApp: () => null,
  OperatorUiHostProvider: ({ children }: { children: unknown }) => children ?? null,
  ThemeProvider: ({ children }: { children: unknown }) => children ?? null,
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(),
}));

vi.mock("../src/url-auth.js", () => ({
  readAuthTokenFromUrl: vi.fn(),
  stripAuthTokenFromUrl: vi.fn(),
}));

describe("apps/web main bootstrap", () => {
  const setupDom = (url: string): ReturnType<typeof vi.spyOn> => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, "", url);
    return vi.spyOn(window.history, "replaceState");
  };

  const makeManagerMock = (): {
    manager: {
      getCore: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    };
    unsubscribe: ReturnType<typeof vi.fn>;
  } => {
    const unsubscribe = vi.fn();
    return {
      unsubscribe,
      manager: {
        getCore: vi.fn(() => ({})),
        subscribe: vi.fn(() => unsubscribe),
        dispose: vi.fn(),
      },
    };
  };

  const expectDisposedOnUnload = (params: {
    unsubscribe: ReturnType<typeof vi.fn>;
    manager: { dispose: ReturnType<typeof vi.fn> };
    elevatedModeStore: { dispose: ReturnType<typeof vi.fn> };
  }): void => {
    window.dispatchEvent(new Event("beforeunload"));

    expect(params.unsubscribe).toHaveBeenCalledTimes(1);
    expect(params.manager.dispose).toHaveBeenCalledTimes(1);
    expect(params.elevatedModeStore.dispose).toHaveBeenCalledTimes(1);
  };

  const arrangeBootstrap = async (initialUrl: string) => {
    const replaceStateSpy = setupDom(initialUrl);

    const operatorCore = await import("@tyrum/operator-core");
    const urlAuth = await import("../src/url-auth.js");
    const reactDomClient = await import("react-dom/client");

    const elevatedModeStore = { dispose: vi.fn() };
    vi.mocked(operatorCore.createElevatedModeStore).mockReturnValue(
      elevatedModeStore as unknown as ReturnType<typeof operatorCore.createElevatedModeStore>,
    );

    const { manager, unsubscribe } = makeManagerMock();
    vi.mocked(operatorCore.createOperatorCoreManager).mockReturnValue(
      manager as unknown as ReturnType<typeof operatorCore.createOperatorCoreManager>,
    );

    const root = { render: vi.fn() };
    vi.mocked(reactDomClient.createRoot).mockReturnValue(root as never);

    return {
      elevatedModeStore,
      manager,
      operatorCore,
      replaceStateSpy,
      root,
      unsubscribe,
      urlAuth,
    };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("creates the operator core manager and scrubs auth token from the URL", async () => {
    const {
      elevatedModeStore,
      manager,
      operatorCore,
      replaceStateSpy,
      root,
      unsubscribe,
      urlAuth,
    } = await arrangeBootstrap("/ui?token=test#hash");

    const bearerAuth = { type: "bearer-token", token: "test-token" } as const;
    vi.mocked(operatorCore.createBearerTokenAuth).mockReturnValue(
      bearerAuth as unknown as ReturnType<typeof operatorCore.createBearerTokenAuth>,
    );

    vi.mocked(operatorCore.createGatewayAuthSession).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue("test-token");
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui#hash");

    await import("../src/main.tsx");

    const expectedHttpBaseUrl = window.location.origin;
    const expectedWsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("test-token");
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        httpBaseUrl: expectedHttpBaseUrl,
      }),
    );
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: expectedWsUrl,
        httpBaseUrl: expectedHttpBaseUrl,
        baselineAuth: bearerAuth,
        elevatedModeStore,
      }),
    );
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui#hash");
    expect(root.render).toHaveBeenCalled();

    expectDisposedOnUnload({ unsubscribe, manager, elevatedModeStore });
  });

  it("uses browser cookie auth when no token is present and does not rewrite the URL", async () => {
    const {
      elevatedModeStore,
      manager,
      operatorCore,
      replaceStateSpy,
      root,
      unsubscribe,
      urlAuth,
    } = await arrangeBootstrap("/ui");

    const cookieAuth = { type: "browser-cookie" } as const;
    vi.mocked(operatorCore.createBrowserCookieAuth).mockReturnValue(
      cookieAuth as unknown as ReturnType<typeof operatorCore.createBrowserCookieAuth>,
    );

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBrowserCookieAuth).toHaveBeenCalledTimes(1);
    expect(operatorCore.createBearerTokenAuth).not.toHaveBeenCalled();
    expect(operatorCore.createGatewayAuthSession).not.toHaveBeenCalled();
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineAuth: cookieAuth,
        elevatedModeStore,
      }),
    );
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(root.render).toHaveBeenCalled();

    expectDisposedOnUnload({ unsubscribe, manager, elevatedModeStore });
  });

  it("throws when the root element is missing", async () => {
    await expect(import("../src/main.tsx")).rejects.toThrow("Missing root element (#root).");
  });
});
