// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("@tyrum/operator-core", () => ({
  createAdminModeStore: vi.fn(),
  createBearerTokenAuth: vi.fn(),
  createBrowserCookieAuth: vi.fn(),
  createOperatorCoreManager: vi.fn(),
}));

vi.mock("@tyrum/operator-ui", () => ({
  OperatorUiApp: () => null,
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
  it("creates the operator core manager and scrubs auth token from the URL", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, "", "/ui?token=test#hash");

    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const operatorCore = await import("@tyrum/operator-core");
    const urlAuth = await import("../src/url-auth.js");
    const reactDomClient = await import("react-dom/client");

    const adminModeStore = { dispose: vi.fn() };
    vi.mocked(operatorCore.createAdminModeStore).mockReturnValue(
      adminModeStore as unknown as ReturnType<typeof operatorCore.createAdminModeStore>,
    );

    const bearerAuth = { type: "bearer-token", token: "test-token" } as const;
    vi.mocked(operatorCore.createBearerTokenAuth).mockReturnValue(
      bearerAuth as unknown as ReturnType<typeof operatorCore.createBearerTokenAuth>,
    );

    vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue("test-token");
    vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui#hash");

    const unsubscribe = vi.fn();
    const manager = {
      getCore: vi.fn(() => ({})),
      subscribe: vi.fn(() => unsubscribe),
      dispose: vi.fn(),
    };
    vi.mocked(operatorCore.createOperatorCoreManager).mockReturnValue(
      manager as unknown as ReturnType<typeof operatorCore.createOperatorCoreManager>,
    );

    const root = { render: vi.fn() };
    vi.mocked(reactDomClient.createRoot).mockReturnValue(root as never);

    await import("../src/main.tsx");

    const expectedHttpBaseUrl = window.location.origin;
    const expectedWsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    expect(operatorCore.createBearerTokenAuth).toHaveBeenCalledWith("test-token");
    expect(operatorCore.createOperatorCoreManager).toHaveBeenCalledWith(
      expect.objectContaining({
        wsUrl: expectedWsUrl,
        httpBaseUrl: expectedHttpBaseUrl,
        baselineAuth: bearerAuth,
        adminModeStore,
      }),
    );
    expect(replaceStateSpy).toHaveBeenCalledWith(expect.anything(), "", "/ui#hash");
    expect(root.render).toHaveBeenCalled();

    window.dispatchEvent(new Event("beforeunload"));

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(manager.dispose).toHaveBeenCalledTimes(1);
    expect(adminModeStore.dispose).toHaveBeenCalledTimes(1);
  });
});
