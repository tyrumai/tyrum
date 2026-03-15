// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tyrum/operator-core/browser", () => ({
  createBearerTokenAuth: vi.fn(),
  createDeviceIdentity: vi.fn(),
  createElevatedModeStore: vi.fn(),
  createOperatorCore: vi.fn(),
  createOperatorCoreManager: vi.fn(),
  createTyrumHttpClient: vi.fn(),
  httpAuthForAuth: vi.fn(),
}));

vi.mock("@tyrum/operator-ui", () => ({
  ADMIN_ACCESS_SCOPES: ["operator.approvals", "operator.pairing", "operator.admin"],
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

  type WebAuthPersistence = {
    hasStoredToken: boolean;
    saveToken: (token: string) => void;
    clearToken: () => void;
  };

  type OperatorUiAppProps = {
    adminAccessController?: {
      enter: () => Promise<void>;
      exit: () => Promise<void>;
    };
    onReloadPage: () => void;
    onReconfigureGateway: (httpUrl: string, wsUrl: string) => void;
    webAuthPersistence: WebAuthPersistence;
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
    vi.mocked(operatorCore.createBearerTokenAuth).mockImplementation(((token: string) => ({
      type: "bearer-token",
      token,
    })) as typeof operatorCore.createBearerTokenAuth);

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
    vi.unstubAllEnvs();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("uses a URL token as bearer auth, persists it, and strips it from the URL", async () => {
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
    } = await arrangeBootstrap("/ui?token=test-token#hash");

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue("test-token");
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui#hash");

    await import("../src/main.tsx");

    const expectedHttpBaseUrl = window.location.origin;
    const expectedWsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("test-token");
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-operator-token", "test-token");
    expect(operatorCore.createDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: expectedWsUrl,
        httpBaseUrl: expectedHttpBaseUrl,
        baselineAuth: { type: "bearer-token", token: "test-token" },
        elevatedModeStore,
        createCore: expect.any(Function),
      }),
    );
    const managerArgs = vi.mocked(operatorCore.createOperatorCoreManager).mock.calls[0]?.[0];
    managerArgs?.createCore?.({
      wsUrl: expectedWsUrl,
      httpBaseUrl: expectedHttpBaseUrl,
      auth: { type: "bearer-token", token: "test-token" },
      elevatedModeStore,
    });
    expect(operatorCore.createOperatorCore).toHaveBeenCalledWith({
      wsUrl: expectedWsUrl,
      httpBaseUrl: expectedHttpBaseUrl,
      auth: { type: "bearer-token", token: "test-token" },
      elevatedModeStore,
      deviceIdentity,
    });
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui#hash");
    expect(root.render).toHaveBeenCalled();

    const props = getRenderedOperatorUiProps(root);
    expect(props.webAuthPersistence.hasStoredToken).toBe(true);

    expectDisposedOnUnload({ unsubscribe, manager, elevatedModeStore });
  });

  it("prefers a URL token over an already-saved browser token", async () => {
    const { core, operatorCore, replaceStateSpy, urlAuth } =
      await arrangeBootstrap("/ui?token=url-token");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue("url-token");
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("url-token");
    expect(operatorCore.createBearerTokenAuth).not.toHaveBeenCalledWith("stored-token");
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-operator-token", "url-token");
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui");
  });

  it("auto-connects with a stored token when there is no URL token", async () => {
    const { core, operatorCore, replaceStateSpy, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(true);
  });

  it("prefers stored gateway URLs over browser defaults", async () => {
    const { operatorCore, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-gateway-http", "http://stored-gateway.internal");
    localStorage.setItem("tyrum-gateway-ws", "ws://stored-gateway.internal/ws");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createTyrumHttpClient).toHaveBeenCalledWith({
      baseUrl: "http://stored-gateway.internal",
      auth: { type: "bearer", token: "baseline" },
    });
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        httpBaseUrl: "http://stored-gateway.internal",
        wsUrl: "ws://stored-gateway.internal/ws",
      }),
    );
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("uses VITE gateway overrides when storage is empty", async () => {
    vi.stubEnv("VITE_GATEWAY_HTTP_BASE_URL", "  https://env-gateway.example.test/api  ");
    vi.stubEnv("VITE_GATEWAY_WS_URL", "  wss://env-gateway.example.test/ws  ");

    const { operatorCore, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createTyrumHttpClient).toHaveBeenCalledWith({
      baseUrl: "https://env-gateway.example.test/api",
      auth: { type: "bearer", token: "baseline" },
    });
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        httpBaseUrl: "https://env-gateway.example.test/api",
        wsUrl: "wss://env-gateway.example.test/ws",
      }),
    );
  });

  it("uses empty bearer auth with no saved token and stays on the connect page", async () => {
    const { core, operatorCore, replaceStateSpy, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("");
    expect(core.connect).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("throws when the root element is missing", async () => {
    await expect(import("../src/main.tsx")).rejects.toThrow("Missing root element (#root).");
  });

  it("re-renders on manager updates and wires reload, gateway, and token persistence actions", async () => {
    const { manager, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

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
    props.webAuthPersistence.saveToken("next-token");
    props.webAuthPersistence.clearToken();
    props.onReconfigureGateway("http://gateway.internal", "ws://gateway.internal/ws");

    expect(setItemSpy).toHaveBeenCalledWith("tyrum-operator-token", "next-token");
    expect(removeItemSpy).toHaveBeenCalledWith("tyrum-operator-token");
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-gateway-http", "http://gateway.internal");
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-gateway-ws", "ws://gateway.internal/ws");
    expect(reloadPage.reloadPage).toHaveBeenCalledTimes(4);
  });

  it("still reloads when gateway reconfiguration cannot be persisted", async () => {
    const { reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

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

  it("surfaces token persistence failures to the caller instead of reloading", async () => {
    const { reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    expect(() => props.webAuthPersistence.saveToken("broken-token")).toThrow("storage unavailable");
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });
});
