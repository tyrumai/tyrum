// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrangeBootstrap,
  expectDisposedOnUnload,
  getRenderedOperatorUiProps,
  jsonResponse,
  resetWebMainTestState,
} from "./main.test-support.js";

describe("apps/web main bootstrap", () => {
  beforeEach(() => {
    resetWebMainTestState();
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
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "test-token",
      httpBaseUrl: expectedHttpBaseUrl,
      credentials: "include",
    });
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
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "url-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(setItemSpy).toHaveBeenCalledWith("tyrum-operator-token", "url-token");
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui");
  });

  it("continues bootstrapping with a URL token when browser storage is unavailable", async () => {
    const { core, operatorCore, replaceStateSpy, root, urlAuth } =
      await arrangeBootstrap("/ui?token=url-token");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue("url-token");
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("url-token");
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "url-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui");
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("auto-connects with a stored token when there is no URL token", async () => {
    const { core, operatorCore, replaceStateSpy, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "stored-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();
    const props = getRenderedOperatorUiProps(root);
    expect(props.webAuthPersistence.hasStoredToken).toBe(true);
    expect(await props.webAuthPersistence.readToken?.()).toBe("stored-token");
  });

  it("drops invalid stored tokens when browser session bootstrap is unauthorized", async () => {
    const { core, operatorCore, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthSession).mockResolvedValue(
      jsonResponse(401, { error: "unauthorized", message: "invalid token" }),
    );
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(operatorCore.createBearerTokenAuth).toHaveBeenLastCalledWith("");
    expect(removeItemSpy).toHaveBeenCalledWith("tyrum-operator-token");
    expect(core.connect).not.toHaveBeenCalled();
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("drops invalid stored tokens when browser session bootstrap is forbidden", async () => {
    const { core, operatorCore, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthSession).mockResolvedValue(
      jsonResponse(403, { error: "forbidden", message: "admin token required" }),
    );
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(operatorCore.createBearerTokenAuth).toHaveBeenLastCalledWith("");
    expect(removeItemSpy).toHaveBeenCalledWith("tyrum-operator-token");
    expect(core.connect).not.toHaveBeenCalled();
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("keeps bearer bootstrap when browser session sync fails transiently", async () => {
    const { core, operatorCore, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthSession).mockRejectedValue(
      new Error("gateway unavailable"),
    );

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(core.connect).toHaveBeenCalledTimes(1);
  });

  it("keeps bearer bootstrap when browser session sync returns a transient 5xx response", async () => {
    const { core, operatorCore, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthSession).mockResolvedValue(
      jsonResponse(503, {
        error: "service_unavailable",
        message: "Authentication service is unavailable; please try again later.",
      }),
    );

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("stored-token");
    expect(core.connect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("tyrum-operator-token")).toBe("stored-token");
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
    const props = getRenderedOperatorUiProps(root);
    expect(props.webAuthPersistence.hasStoredToken).toBe(false);
    expect(await props.webAuthPersistence.readToken?.()).toBeNull();
  });

  it("falls back to the connect page when token storage cannot be read", async () => {
    const { core, operatorCore, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === "tyrum-operator-token") {
        throw new Error("storage unavailable");
      }
      return null;
    });

    await import("../src/main.tsx");

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("");
    expect(core.connect).not.toHaveBeenCalled();
    expect(getRenderedOperatorUiProps(root).webAuthPersistence.hasStoredToken).toBe(false);
  });

  it("throws when the root element is missing", async () => {
    await expect(import("../src/main.tsx")).rejects.toThrow("Missing root element (#root).");
  });

  it("re-renders on manager updates and wires reload, gateway, and token persistence actions", async () => {
    const { manager, operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

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
    await props.webAuthPersistence.saveToken("next-token");
    await props.webAuthPersistence.clearToken();
    props.onReconfigureGateway("http://gateway.internal", "ws://gateway.internal/ws");

    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "next-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(operatorCore.clearGatewayAuthSession).toHaveBeenCalledWith({
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
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
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("broken-token")).rejects.toThrow(
      "storage unavailable",
    );
    expect(operatorCore.clearGatewayAuthSession).toHaveBeenCalledWith({
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("surfaces plain-text saveToken failures from browser session bootstrap", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.createGatewayAuthSession).mockResolvedValue(
      new Response("gateway unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
    );

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.saveToken("broken-token")).rejects.toThrow(
      "gateway unavailable",
    );
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
    expect(localStorage.getItem("tyrum-operator-token")).toBeNull();
  });

  it("keeps the saved token when logout fails", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    vi.mocked(operatorCore.clearGatewayAuthSession).mockResolvedValue(
      jsonResponse(503, {
        error: "service_unavailable",
        message: "Authentication service is unavailable; please try again later.",
      }),
    );
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    await import("../src/main.tsx");

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.clearToken()).rejects.toThrow(
      "Authentication service is unavailable; please try again later.",
    );
    expect(removeItemSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem("tyrum-operator-token")).toBe("stored-token");
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });

  it("restores the browser session when token removal fails during logout", async () => {
    const { operatorCore, reloadPage, root, urlAuth } = await arrangeBootstrap("/ui");

    localStorage.setItem("tyrum-operator-token", "stored-token");
    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await import("../src/main.tsx");

    vi.mocked(operatorCore.createGatewayAuthSession).mockClear();
    vi.mocked(operatorCore.clearGatewayAuthSession).mockClear();

    const props = getRenderedOperatorUiProps(root);
    await expect(props.webAuthPersistence.clearToken()).rejects.toThrow("storage unavailable");

    expect(removeItemSpy).toHaveBeenCalledWith("tyrum-operator-token");
    expect(operatorCore.clearGatewayAuthSession).toHaveBeenCalledWith({
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
      token: "stored-token",
      httpBaseUrl: window.location.origin,
      credentials: "include",
    });
    expect(localStorage.getItem("tyrum-operator-token")).toBe("stored-token");
    expect(reloadPage.reloadPage).not.toHaveBeenCalled();
  });
});
