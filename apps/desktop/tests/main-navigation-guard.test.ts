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
  const ipcMainHandleMockInner = vi.fn();
  const nativeThemeOnMockInner = vi.fn();

  const webContentsOnMockInner = vi.fn();
  const setWindowOpenHandlerMockInner = vi.fn();
  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      webContents: {
        on: webContentsOnMockInner,
        setWindowOpenHandler: setWindowOpenHandlerMockInner,
      },
    };
  });
  const appWhenReadyMockInner = vi.fn(() => Promise.resolve());
  const appOnMockInner = vi.fn();
  const appQuitMockInner = vi.fn();
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appSetAppUserModelIdMockInner = vi.fn();
  const appGetPathMockInner = vi.fn(() => "/tmp/tyrum-desktop-tests");
  const shellOpenExternalMockInner = vi.fn(async () => {});
  const menuBuildFromTemplateMockInner = vi.fn(() => ({}) as never);
  const menuSetApplicationMenuMockInner = vi.fn();

  const screenGetPrimaryDisplayMockInner = vi.fn(() => ({
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  }));
  const screenGetAllDisplaysMockInner = vi.fn(() => [
    {
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  ]);

  const registerConfigIpcMockInner = vi.fn();
  const registerGatewayIpcMockInner = vi.fn(() => ({ stop: vi.fn() }));
  const registerNodeIpcMockInner = vi.fn();
  const registerUpdateIpcMockInner = vi.fn();

  const configExistsMockInner = vi.fn(() => true);
  const loadConfigMockInner = vi.fn(() => ({ mode: "remote" }));
  const startEmbeddedGatewayFromConfigMockInner = vi.fn(async () => ({
    status: "running",
    port: 8788,
  }));

  const loadWindowStateMockInner = vi.fn(() => null);
  const saveWindowStateMockInner = vi.fn();
  const captureWindowStateMockInner = vi.fn();
  const ensureVisibleBoundsMockInner = vi.fn((bounds: unknown) => bounds);

  return {
    appRequestSingleInstanceLockMock: appRequestSingleInstanceLockMockInner,
    appGetPathMock: appGetPathMockInner,
    appSetAppUserModelIdMock: appSetAppUserModelIdMockInner,
    appWhenReadyMock: appWhenReadyMockInner,
    appOnMock: appOnMockInner,
    appQuitMock: appQuitMockInner,
    browserWindowMock: browserWindowMockInner,
    ipcMainHandleMock: ipcMainHandleMockInner,
    nativeThemeOnMock: nativeThemeOnMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    shellOpenExternalMock: shellOpenExternalMockInner,
    webContentsOnMock: webContentsOnMockInner,
    setWindowOpenHandlerMock: setWindowOpenHandlerMockInner,
    registerConfigIpcMock: registerConfigIpcMockInner,
    registerGatewayIpcMock: registerGatewayIpcMockInner,
    registerNodeIpcMock: registerNodeIpcMockInner,
    registerUpdateIpcMock: registerUpdateIpcMockInner,
    configExistsMock: configExistsMockInner,
    loadConfigMock: loadConfigMockInner,
    startEmbeddedGatewayFromConfigMock: startEmbeddedGatewayFromConfigMockInner,
    captureWindowStateMock: captureWindowStateMockInner,
    ensureVisibleBoundsMock: ensureVisibleBoundsMockInner,
    loadWindowStateMock: loadWindowStateMockInner,
    saveWindowStateMock: saveWindowStateMockInner,
    screenGetAllDisplaysMock: screenGetAllDisplaysMockInner,
    screenGetPrimaryDisplayMock: screenGetPrimaryDisplayMockInner,
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
