import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

const {
  appRequestSingleInstanceLockMock,
  appGetPathMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  appOnMock,
  appQuitMock,
  browserWindowMock,
  ipcMainHandleMock,
  nativeThemeOnMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
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
  captureWindowStateMock,
  ensureVisibleBoundsMock,
  loadWindowStateMock,
  saveWindowStateMock,
  screenGetAllDisplaysMock,
  screenGetPrimaryDisplayMock,
} = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn();
  const nativeThemeOnMock = vi.fn();

  const webContentsOnMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
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
  const appGetPathMock = vi.fn(() => "/tmp/tyrum-desktop-tests");
  const shellOpenExternalMock = vi.fn(async () => {});
  const menuBuildFromTemplateMock = vi.fn(() => ({}) as never);
  const menuSetApplicationMenuMock = vi.fn();

  const screenGetPrimaryDisplayMock = vi.fn(() => ({
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  }));
  const screenGetAllDisplaysMock = vi.fn(() => [
    {
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  ]);

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

  const loadWindowStateMock = vi.fn(() => null);
  const saveWindowStateMock = vi.fn();
  const captureWindowStateMock = vi.fn();
  const ensureVisibleBoundsMock = vi.fn((bounds: unknown) => bounds);

  return {
    appRequestSingleInstanceLockMock,
    appGetPathMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    appOnMock,
    appQuitMock,
    browserWindowMock,
    ipcMainHandleMock,
    nativeThemeOnMock,
    menuBuildFromTemplateMock,
    menuSetApplicationMenuMock,
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
    captureWindowStateMock,
    ensureVisibleBoundsMock,
    loadWindowStateMock,
    saveWindowStateMock,
    screenGetAllDisplaysMock,
    screenGetPrimaryDisplayMock,
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    getPath: appGetPathMock,
  },
  BrowserWindow: browserWindowMock,
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  nativeTheme: {
    themeSource: "system",
    shouldUseDarkColors: false,
    shouldUseHighContrastColors: false,
    shouldUseInvertedColorScheme: false,
    on: nativeThemeOnMock,
  },
  Menu: {
    buildFromTemplate: menuBuildFromTemplateMock,
    setApplicationMenu: menuSetApplicationMenuMock,
  },
  screen: {
    getAllDisplays: screenGetAllDisplaysMock,
    getPrimaryDisplay: screenGetPrimaryDisplayMock,
  },
  shell: {
    openExternal: shellOpenExternalMock,
  },
}));

vi.mock("../src/main/window-state.js", () => ({
  captureWindowState: captureWindowStateMock,
  ensureVisibleBounds: ensureVisibleBoundsMock,
  loadWindowState: loadWindowStateMock,
  saveWindowState: saveWindowStateMock,
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
    appGetPathMock.mockClear();
    screenGetAllDisplaysMock.mockClear();
    screenGetPrimaryDisplayMock.mockClear();
    loadWindowStateMock.mockClear();
    saveWindowStateMock.mockClear();
    captureWindowStateMock.mockClear();
    ensureVisibleBoundsMock.mockClear();
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
