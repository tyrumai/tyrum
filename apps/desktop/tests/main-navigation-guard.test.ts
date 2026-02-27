import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  appOnMock,
  appQuitMock,
  browserWindowMock,
  shellOpenExternalMock,
  webContentsOnMock,
  setWindowOpenHandlerMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  configExistsMock,
  loadConfigMock,
  startEmbeddedGatewayFromConfigMock,
} = vi.hoisted(() => {
  const webContentsOnMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      webContents: {
        on: webContentsOnMock,
        setWindowOpenHandler: setWindowOpenHandlerMock,
      },
    };
  });
  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appOnMock = vi.fn();
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const shellOpenExternalMock = vi.fn(async () => {});

  const registerConfigIpcMock = vi.fn();
  const registerGatewayIpcMock = vi.fn(() => ({ stop: vi.fn() }));
  const registerNodeIpcMock = vi.fn();
  const registerUpdateIpcMock = vi.fn();

  const configExistsMock = vi.fn(() => true);
  const loadConfigMock = vi.fn(() => ({ mode: "remote" }));
  const startEmbeddedGatewayFromConfigMock = vi.fn(async () => ({
    status: "running",
    port: 8788,
  }));

  return {
    appRequestSingleInstanceLockMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    appOnMock,
    appQuitMock,
    browserWindowMock,
    shellOpenExternalMock,
    webContentsOnMock,
    setWindowOpenHandlerMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    registerNodeIpcMock,
    registerUpdateIpcMock,
    configExistsMock,
    loadConfigMock,
    startEmbeddedGatewayFromConfigMock,
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
  },
  BrowserWindow: browserWindowMock,
  shell: {
    openExternal: shellOpenExternalMock,
  },
}));

vi.mock("../src/main/ipc/config-ipc.js", () => ({
  registerConfigIpc: registerConfigIpcMock,
}));

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  registerGatewayIpc: registerGatewayIpcMock,
  startEmbeddedGatewayFromConfig: startEmbeddedGatewayFromConfigMock,
}));

vi.mock("../src/main/ipc/node-ipc.js", () => ({
  registerNodeIpc: registerNodeIpcMock,
  shutdownNodeResources: vi.fn(async () => {}),
}));

vi.mock("../src/main/ipc/update-ipc.js", () => ({
  registerUpdateIpc: registerUpdateIpcMock,
}));

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: loadConfigMock,
}));

describe("main window navigation guardrails", () => {
  beforeEach(() => {
    vi.resetModules();
    webContentsOnMock.mockReset();
    setWindowOpenHandlerMock.mockReset();
    shellOpenExternalMock.mockReset();
    browserWindowMock.mockClear();
  });

  it("blocks top-level navigations and opens external links in the system browser", async () => {
    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    expect(browserWindowMock).toHaveBeenCalledTimes(1);
    expect(setWindowOpenHandlerMock).toHaveBeenCalledTimes(1);
    expect(webContentsOnMock).toHaveBeenCalledWith("will-navigate", expect.any(Function));

    const windowOpenHandler = setWindowOpenHandlerMock.mock.calls[0]?.[0] as
      | ((details: { url: string }) => { action: "deny" | "allow" })
      | undefined;
    expect(windowOpenHandler).toBeTypeOf("function");
    const openResult = windowOpenHandler?.({ url: "https://example.com" });
    expect(openResult).toEqual({ action: "deny" });
    expect(shellOpenExternalMock).toHaveBeenCalledWith("https://example.com");

    const willNavigateHandler = webContentsOnMock.mock.calls.find(
      (call) => call[0] === "will-navigate",
    )?.[1] as ((event: { preventDefault: () => void }, url: string) => void) | undefined;
    expect(willNavigateHandler).toBeTypeOf("function");
    const event = { preventDefault: vi.fn() };
    willNavigateHandler?.(event, "https://example.com/docs");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shellOpenExternalMock).toHaveBeenCalledWith("https://example.com/docs");
  });
});
