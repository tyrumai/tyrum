import { beforeEach, describe, expect, it, vi } from "vitest";

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
  nativeThemeOnMock,
  readyToShowHandlers,
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
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const readyToShowHandlers: Array<() => void> = [];
  const browserWindowShowMock = vi.fn();
  const browserWindowOnceMock = vi.fn((event: string, handler: () => void) => {
    if (event === "ready-to-show") {
      readyToShowHandlers.push(handler);
    }
  });
  const webContentsOnMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      once: browserWindowOnceMock,
      show: browserWindowShowMock,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        on: webContentsOnMock,
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
        setWindowOpenHandler: setWindowOpenHandlerMock,
      },
    };
  });

  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appOnMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlers.set(event, handler);
  });
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const appGetPathMock = vi.fn(() => "/tmp/tyrum-desktop-tests");

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

  const ipcMainHandleMock = vi.fn();
  const nativeThemeOnMock = vi.fn();

  const menuBuildFromTemplateMock = vi.fn(() => ({}));
  const menuSetApplicationMenuMock = vi.fn();

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
    appHandlers,
    appOnMock,
    appQuitMock,
    browserWindowMock,
    browserWindowOnceMock,
    browserWindowShowMock,
    ipcMainHandleMock,
    menuBuildFromTemplateMock,
    menuSetApplicationMenuMock,
    nativeThemeOnMock,
    readyToShowHandlers,
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
