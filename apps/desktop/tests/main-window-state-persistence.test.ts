import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appGetPathMock,
  appOnMock,
  appQuitMock,
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  browserWindowMock,
  captureWindowStateMock,
  browserWindowMaximizeMock,
  browserWindowOnMock,
  configExistsMock,
  dialogShowMessageBoxMock,
  ensureVisibleBoundsMock,
  ipcMainHandleMock,
  loadConfigMock,
  loadWindowStateMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  nativeThemeOnMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  screenGetAllDisplaysMock,
  screenGetPrimaryDisplayMock,
  saveWindowStateMock,
  startEmbeddedGatewayFromConfigMock,
  windowHandlers,
} = vi.hoisted(() => {
  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appOnMock = vi.fn();
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const appGetPathMock = vi.fn(() => "/tmp/tyrum-desktop-tests");

  const windowHandlers = new Map<string, (...args: unknown[]) => void>();
  const browserWindowOnMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    windowHandlers.set(event, handler);
  });
  const browserWindowMaximizeMock = vi.fn();
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      maximize: browserWindowMaximizeMock,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: browserWindowOnMock,
      once: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMaximized: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
  });

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

  const menuBuildFromTemplateMock = vi.fn(() => ({}));
  const menuSetApplicationMenuMock = vi.fn();
  const dialogShowMessageBoxMock = vi.fn(async () => ({ response: 0 }));

  const ipcMainHandleMock = vi.fn();
  const nativeThemeOnMock = vi.fn();

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

  const loadWindowStateMock = vi.fn(() => ({
    bounds: { x: 2000, y: 100, width: 800, height: 600 },
    isMaximized: true,
  }));
  const ensureVisibleBoundsMock = vi.fn((_bounds: unknown, _workAreas: unknown) => ({
    x: 1120,
    y: 100,
    width: 800,
    height: 600,
  }));
  const saveWindowStateMock = vi.fn();
  const captureWindowStateMock = vi.fn(
    (_window: unknown, options?: { isMaximized?: boolean }) =>
      ({
        bounds: { x: 100, y: 120, width: 800, height: 600 },
        isMaximized: options?.isMaximized ?? false,
      }) as const,
  );

  return {
    appGetPathMock,
    appOnMock,
    appQuitMock,
    appRequestSingleInstanceLockMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    browserWindowMock,
    captureWindowStateMock,
    browserWindowMaximizeMock,
    browserWindowOnMock,
    configExistsMock,
    dialogShowMessageBoxMock,
    ensureVisibleBoundsMock,
    ipcMainHandleMock,
    loadConfigMock,
    loadWindowStateMock,
    menuBuildFromTemplateMock,
    menuSetApplicationMenuMock,
    nativeThemeOnMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    registerNodeIpcMock,
    registerUpdateIpcMock,
    screenGetAllDisplaysMock,
    screenGetPrimaryDisplayMock,
    saveWindowStateMock,
    startEmbeddedGatewayFromConfigMock,
    windowHandlers,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: appGetPathMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    whenReady: appWhenReadyMock,
  },
  BrowserWindow: browserWindowMock,
  dialog: {
    showMessageBox: dialogShowMessageBoxMock,
  },
  Menu: {
    buildFromTemplate: menuBuildFromTemplateMock,
    setApplicationMenu: menuSetApplicationMenuMock,
  },
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
  screen: {
    getAllDisplays: screenGetAllDisplaysMock,
    getPrimaryDisplay: screenGetPrimaryDisplayMock,
  },
  shell: {
    openExternal: vi.fn(async () => {}),
  },
}));

vi.mock("../src/main/window-state.js", () => ({
  ensureVisibleBounds: ensureVisibleBoundsMock,
  loadWindowState: loadWindowStateMock,
  captureWindowState: captureWindowStateMock,
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

describe("main window state persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    appGetPathMock.mockClear();
    browserWindowMock.mockClear();
    browserWindowOnMock.mockClear();
    browserWindowMaximizeMock.mockClear();
    loadWindowStateMock.mockClear();
    ensureVisibleBoundsMock.mockClear();
    screenGetAllDisplaysMock.mockClear();
    screenGetPrimaryDisplayMock.mockClear();
    menuBuildFromTemplateMock.mockClear();
    menuSetApplicationMenuMock.mockClear();
    dialogShowMessageBoxMock.mockClear();
    ipcMainHandleMock.mockReset();
    nativeThemeOnMock.mockReset();
    captureWindowStateMock.mockClear();
    saveWindowStateMock.mockClear();
    windowHandlers.clear();
  });

  it("restores persisted bounds and maximized state", async () => {
    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    expect(loadWindowStateMock).toHaveBeenCalledTimes(1);
    expect(ensureVisibleBoundsMock).toHaveBeenCalledTimes(1);

    expect(browserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 1120,
        y: 100,
        width: 800,
        height: 600,
      }),
    );
    expect(browserWindowMaximizeMock).toHaveBeenCalledTimes(1);
  });

  it("preserves maximized state when closing a minimized window", async () => {
    loadWindowStateMock.mockReturnValueOnce(null);

    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    const window = browserWindowMock.mock.results[0]?.value;
    expect(window).toBeTruthy();

    const maximizeHandler = windowHandlers.get("maximize");
    expect(maximizeHandler).toBeTypeOf("function");
    maximizeHandler?.();

    const closeHandler = windowHandlers.get("close");
    expect(closeHandler).toBeTypeOf("function");
    closeHandler?.();

    expect(captureWindowStateMock).toHaveBeenCalledWith(window, { isMaximized: true });
    expect(saveWindowStateMock).toHaveBeenCalledWith(
      "/tmp/tyrum-desktop-tests",
      expect.objectContaining({ isMaximized: true }),
    );
  });
});
