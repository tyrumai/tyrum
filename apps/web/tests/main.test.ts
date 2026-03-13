// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tyrum/operator-core/browser", () => ({
  createBearerTokenAuth: vi.fn(),
  createBrowserCookieAuth: vi.fn(),
  createDeviceIdentity: vi.fn(),
  createElevatedModeStore: vi.fn(),
  createGatewayAuthSession: vi.fn(),
  createOperatorCore: vi.fn(),
  createOperatorCoreManager: vi.fn(),
  createTyrumHttpClient: vi.fn(),
  httpAuthForAuth: vi.fn(),
}));

vi.mock("@tyrum/operator-ui", () => ({
  ADMIN_ACCESS_SCOPES: [
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing",
    "operator.admin",
  ],
  createAdminAccessController: vi.fn(() => ({
    enter: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
  })),
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

vi.mock("../src/reload-page.js", () => ({
  reloadPage: vi.fn(),
}));

describe("apps/web main bootstrap", () => {
  type RootMock = { render: ReturnType<typeof vi.fn> };

  type OperatorUiAppProps = {
    adminAccessController?: {
      enter: () => Promise<void>;
      exit: () => Promise<void>;
    };
    onReloadPage: () => void;
    onReconfigureGateway: (httpUrl: string, wsUrl: string) => void;
  };

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
    core: { connect: ReturnType<typeof vi.fn> };
    unsubscribe: ReturnType<typeof vi.fn>;
  } => {
    const core = { connect: vi.fn() };
    const unsubscribe = vi.fn();
    return {
      core,
      unsubscribe,
      manager: {
        getCore: vi.fn(() => core),
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

    const operatorCore = await import("@tyrum/operator-core/browser");
    const reloadPage = await import("../src/reload-page.js");
    const urlAuth = await import("../src/url-auth.js");
    const reactDomClient = await import("react-dom/client");

    const elevatedModeStore = { dispose: vi.fn() };
    vi.mocked(operatorCore.createElevatedModeStore).mockReturnValue(
      elevatedModeStore as unknown as ReturnType<typeof operatorCore.createElevatedModeStore>,
    );
    const deviceIdentity = {
      deviceId: "web-device-1",
      publicKey: "test-public-key",
      privateKey: "test-private-key",
    };
    vi.mocked(operatorCore.createDeviceIdentity).mockResolvedValue(
      deviceIdentity as unknown as Awaited<ReturnType<typeof operatorCore.createDeviceIdentity>>,
    );
    vi.mocked(operatorCore.createOperatorCore).mockReturnValue({} as never);
    vi.mocked(operatorCore.httpAuthForAuth).mockReturnValue({ type: "bearer", token: "baseline" });
    vi.mocked(operatorCore.createTyrumHttpClient).mockReturnValue({
      deviceTokens: {
        issue: vi.fn(),
        revoke: vi.fn(),
      },
    } as never);

    const { manager, unsubscribe, core } = makeManagerMock();
    vi.mocked(operatorCore.createOperatorCoreManager).mockReturnValue(
      manager as unknown as ReturnType<typeof operatorCore.createOperatorCoreManager>,
    );

    const root = { render: vi.fn() };
    vi.mocked(reactDomClient.createRoot).mockReturnValue(root as never);

    return {
      elevatedModeStore,
      deviceIdentity,
      manager,
      operatorCore,
      replaceStateSpy,
      root,
      core,
      unsubscribe,
      reloadPage,
      urlAuth,
    };
  };

  const getRenderedOperatorUiProps = (root: RootMock): OperatorUiAppProps => {
    const strictModeElement = root.render.mock.calls.at(-1)?.[0] as {
      props?: {
        children?: {
          props?: {
            children?: {
              props?: OperatorUiAppProps;
            };
          };
        };
      };
    };
    const props = strictModeElement?.props?.children?.props?.children?.props;
    expect(props).toBeDefined();
    return props as OperatorUiAppProps;
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
      core,
      deviceIdentity,
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
    expect(operatorCore.createDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: expectedWsUrl,
        httpBaseUrl: expectedHttpBaseUrl,
        baselineAuth: bearerAuth,
        elevatedModeStore,
        createCore: expect.any(Function),
      }),
    );
    const managerArgs = vi.mocked(operatorCore.createOperatorCoreManager).mock.calls[0]?.[0];
    managerArgs?.createCore?.({
      wsUrl: expectedWsUrl,
      httpBaseUrl: expectedHttpBaseUrl,
      auth: bearerAuth,
      elevatedModeStore,
    });
    expect(operatorCore.createOperatorCore).toHaveBeenCalledWith({
      wsUrl: expectedWsUrl,
      httpBaseUrl: expectedHttpBaseUrl,
      auth: bearerAuth,
      elevatedModeStore,
      deviceIdentity,
    });
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui#hash");
    expect(root.render).toHaveBeenCalled();

    expectDisposedOnUnload({ unsubscribe, manager, elevatedModeStore });
  });

  it("uses browser cookie auth when no token is present and does not rewrite the URL", async () => {
    const {
      elevatedModeStore,
      core,
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
    expect(operatorCore.createDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(operatorCore.createBearerTokenAuth).not.toHaveBeenCalled();
    expect(operatorCore.createGatewayAuthSession).not.toHaveBeenCalled();
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineAuth: cookieAuth,
        elevatedModeStore,
        createCore: expect.any(Function),
      }),
    );
    expect(core.connect).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(root.render).toHaveBeenCalled();

    expectDisposedOnUnload({ unsubscribe, manager, elevatedModeStore });
  });

  it("throws when the root element is missing", async () => {
    await expect(import("../src/main.tsx")).rejects.toThrow("Missing root element (#root).");
  });

  it("re-renders on manager updates and persists gateway reconfiguration before reloading", async () => {
    const { operatorCore, manager, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    const cookieAuth = { type: "browser-cookie" } as const;
    vi.mocked(operatorCore.createBrowserCookieAuth).mockReturnValue(
      cookieAuth as unknown as ReturnType<typeof operatorCore.createBrowserCookieAuth>,
    );
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    await import("../src/main.tsx");

    const rerender = manager.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(rerender).toBeTypeOf("function");
    expect(root.render).toHaveBeenCalledTimes(1);

    rerender?.();
    expect(root.render).toHaveBeenCalledTimes(2);

    const props = getRenderedOperatorUiProps(root);
    expect(typeof props.adminAccessController?.enter).toBe("function");
    expect(typeof props.adminAccessController?.exit).toBe("function");
    props.onReloadPage();
    props.onReconfigureGateway("http://gateway.internal", "ws://gateway.internal/ws");

    expect(setItemSpy).toHaveBeenCalledWith("tyrum-gateway-http", "http://gateway.internal");
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-gateway-ws", "ws://gateway.internal/ws");
    expect(reloadPage.reloadPage).toHaveBeenCalledTimes(2);
  });

  it("still reloads when gateway reconfiguration cannot be persisted", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    const cookieAuth = { type: "browser-cookie" } as const;
    vi.mocked(operatorCore.createBrowserCookieAuth).mockReturnValue(
      cookieAuth as unknown as ReturnType<typeof operatorCore.createBrowserCookieAuth>,
    );
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    props.onReconfigureGateway("http://gateway.internal", "ws://gateway.internal/ws");

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(reloadPage.reloadPage).toHaveBeenCalledTimes(1);
  });
});
