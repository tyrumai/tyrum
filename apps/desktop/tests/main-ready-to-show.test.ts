import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

const {
  appRequestSingleInstanceLockMock,
  appGetPathMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  appHandlers,
  appOnMock,
  appQuitMock,
  browserWindowMock,
  browserWindowOnceMock,
  browserWindowShowMock,
  ipcMainHandleMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  nativeImageCreateFromDataUrlMock,
  nativeImageCreateFromPathMock,
  nativeThemeOnMock,
  readyToShowHandlers,
  webContentsOnMock,
  trayMock,
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
  const appHandlersInner = new Map<string, (...args: unknown[]) => void>();
  const readyToShowHandlersInner: Array<() => void> = [];
  const browserWindowShowMockInner = vi.fn();
  const browserWindowOnceMockInner = vi.fn((event: string, handler: () => void) => {
    if (event === "ready-to-show") {
      readyToShowHandlersInner.push(handler);
    }
  });
  const webContentsOnMockInner = vi.fn();
  const setWindowOpenHandlerMockInner = vi.fn();
  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      hide: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      once: browserWindowOnceMockInner,
      show: browserWindowShowMockInner,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        on: webContentsOnMockInner,
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
        setWindowOpenHandler: setWindowOpenHandlerMockInner,
      },
    };
  });

  const appWhenReadyMockInner = vi.fn(() => Promise.resolve());
  const appOnMockInner = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlersInner.set(event, handler);
  });
  const appQuitMockInner = vi.fn();
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appSetAppUserModelIdMockInner = vi.fn();
  const appGetPathMockInner = vi.fn(() => "/tmp/tyrum-desktop-tests");

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

  const ipcMainHandleMockInner = vi.fn();
  const nativeThemeOnMockInner = vi.fn();
  const trayMockInner = vi.fn(function MockTray() {
    return {
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
    };
  });
  const nativeImageCreateFromPathMockInner = vi.fn(() => ({}));
  const nativeImageCreateFromDataUrlMockInner = vi.fn(() => ({
    setTemplateImage: vi.fn(),
  }));

  const menuBuildFromTemplateMockInner = vi.fn(() => ({}));
  const menuSetApplicationMenuMockInner = vi.fn();

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
    appHandlers: appHandlersInner,
    appOnMock: appOnMockInner,
    appQuitMock: appQuitMockInner,
    browserWindowMock: browserWindowMockInner,
    browserWindowOnceMock: browserWindowOnceMockInner,
    browserWindowShowMock: browserWindowShowMockInner,
    ipcMainHandleMock: ipcMainHandleMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    nativeThemeOnMock: nativeThemeOnMockInner,
    nativeImageCreateFromDataUrlMock: nativeImageCreateFromDataUrlMockInner,
    nativeImageCreateFromPathMock: nativeImageCreateFromPathMockInner,
    readyToShowHandlers: readyToShowHandlersInner,
    trayMock: trayMockInner,
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
    getAppPath: vi.fn(() => "/tmp/tyrum-desktop-tests"),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    setLoginItemSettings: vi.fn(),
    getPath: appGetPathMock,
    isPackaged: false,
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
  Tray: trayMock,
  nativeImage: {
    createFromDataURL: nativeImageCreateFromDataUrlMock,
    createFromPath: nativeImageCreateFromPathMock,
  },
  screen: {
    getAllDisplays: screenGetAllDisplaysMock,
    getPrimaryDisplay: screenGetPrimaryDisplayMock,
  },
  shell: {
    openExternal: vi.fn(async () => {}),
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

describe("main window ready-to-show", () => {
  beforeEach(() => {
    vi.resetModules();
    appHandlers.clear();
    appWhenReadyMock.mockClear();
    appOnMock.mockClear();
    appQuitMock.mockClear();
    appGetPathMock.mockClear();
    readyToShowHandlers.length = 0;
    browserWindowMock.mockClear();
    browserWindowOnceMock.mockClear();
    browserWindowShowMock.mockClear();
    ipcMainHandleMock.mockReset();
    menuBuildFromTemplateMock.mockClear();
    menuSetApplicationMenuMock.mockClear();
    nativeThemeOnMock.mockReset();
    webContentsOnMock.mockReset();
    setWindowOpenHandlerMock.mockReset();
    screenGetAllDisplaysMock.mockClear();
    screenGetPrimaryDisplayMock.mockClear();
    loadWindowStateMock.mockClear();
    saveWindowStateMock.mockClear();
    captureWindowStateMock.mockClear();
    ensureVisibleBoundsMock.mockClear();
  });

  it("shows the window only after ready-to-show", async () => {
    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    expect(browserWindowMock).toHaveBeenCalledTimes(1);
    expect(browserWindowOnceMock).toHaveBeenCalledWith("ready-to-show", expect.any(Function));
    expect(browserWindowShowMock).not.toHaveBeenCalled();

    const readyToShowHandler = readyToShowHandlers[0];
    expect(readyToShowHandler).toBeTypeOf("function");
    readyToShowHandler?.();

    expect(browserWindowShowMock).toHaveBeenCalledTimes(1);
  });

  it("does not show the window before ready-to-show when second-instance fires early", async () => {
    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    const secondInstanceHandler = appHandlers.get("second-instance");
    expect(secondInstanceHandler).toBeTypeOf("function");
    secondInstanceHandler?.({}, ["electron", "tyrum://open?x=1"], "/tmp");

    expect(browserWindowShowMock).not.toHaveBeenCalled();

    const readyToShowHandler = readyToShowHandlers[0];
    expect(readyToShowHandler).toBeTypeOf("function");
    readyToShowHandler?.();

    expect(browserWindowShowMock).toHaveBeenCalledTimes(1);
  });
});
