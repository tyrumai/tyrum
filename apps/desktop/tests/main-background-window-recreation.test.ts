import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

const {
  appHandlers,
  appOnMock,
  appQuitMock,
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  backgroundControllerDepsRef,
  backgroundModeControllerMock,
  browserWindowInstances,
  browserWindowMock,
  ipcMainHandleMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  nativeThemeOnMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  configExistsMock,
  loadConfigMock,
  startEmbeddedGatewayFromConfigMock,
  loadWindowStateMock,
  captureWindowStateMock,
  ensureVisibleBoundsMock,
  saveWindowStateMock,
} = vi.hoisted(() => {
  const appHandlersInner = new Map<string, (...args: unknown[]) => void>();
  const backgroundControllerDepsRefInner: {
    current: {
      onRequestNavigate: (request: { pageId: "connection" }) => void;
      onShowMainWindow: () => void;
    } | null;
  } = { current: null };
  const browserWindowInstancesInner: Array<{
    handlers: Map<string, (...args: unknown[]) => void>;
    focus: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    readyToShowHandler: (() => void) | null;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    webContents: {
      isDestroyed: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
  }> = [];

  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const instance = {
      handlers,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      }),
      readyToShowHandler: null as (() => void) | null,
      once: vi.fn((event: string, handler: () => void) => {
        if (event === "ready-to-show") {
          instance.readyToShowHandler = handler;
        }
      }),
      hide: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        on: vi.fn(),
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
    browserWindowInstancesInner.push(instance);
    return instance;
  });

  const backgroundModeControllerMockInner = vi.fn(function MockBackgroundModeController(deps) {
    backgroundControllerDepsRefInner.current = deps;
    return {
      initialize: vi.fn(() => ({
        enabled: true,
        supported: true,
        trayAvailable: true,
        loginAutoStartActive: false,
        mode: "remote",
      })),
      setGatewayStatus: vi.fn(),
      shouldHideOnClose: vi.fn(() => false),
      shouldStartHiddenOnLaunch: vi.fn(() => false),
    };
  });

  const appWhenReadyMockInner = vi.fn(() => Promise.resolve());
  const appOnMockInner = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlersInner.set(event, handler);
  });
  const appQuitMockInner = vi.fn();
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appSetAppUserModelIdMockInner = vi.fn();
  const ipcMainHandleMockInner = vi.fn();
  const menuBuildFromTemplateMockInner = vi.fn(() => ({}));
  const menuSetApplicationMenuMockInner = vi.fn();
  const nativeThemeOnMockInner = vi.fn();
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
  const captureWindowStateMockInner = vi.fn(() => ({
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    isMaximized: false,
  }));
  const ensureVisibleBoundsMockInner = vi.fn((bounds: unknown) => bounds);
  const saveWindowStateMockInner = vi.fn();

  return {
    appHandlers: appHandlersInner,
    appOnMock: appOnMockInner,
    appQuitMock: appQuitMockInner,
    appRequestSingleInstanceLockMock: appRequestSingleInstanceLockMockInner,
    appSetAppUserModelIdMock: appSetAppUserModelIdMockInner,
    appWhenReadyMock: appWhenReadyMockInner,
    backgroundControllerDepsRef: backgroundControllerDepsRefInner,
    backgroundModeControllerMock: backgroundModeControllerMockInner,
    browserWindowInstances: browserWindowInstancesInner,
    browserWindowMock: browserWindowMockInner,
    ipcMainHandleMock: ipcMainHandleMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    nativeThemeOnMock: nativeThemeOnMockInner,
    registerConfigIpcMock: registerConfigIpcMockInner,
    registerGatewayIpcMock: registerGatewayIpcMockInner,
    registerNodeIpcMock: registerNodeIpcMockInner,
    registerUpdateIpcMock: registerUpdateIpcMockInner,
    configExistsMock: configExistsMockInner,
    loadConfigMock: loadConfigMockInner,
    startEmbeddedGatewayFromConfigMock: startEmbeddedGatewayFromConfigMockInner,
    loadWindowStateMock: loadWindowStateMockInner,
    captureWindowStateMock: captureWindowStateMockInner,
    ensureVisibleBoundsMock: ensureVisibleBoundsMockInner,
    saveWindowStateMock: saveWindowStateMockInner,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/tyrum-desktop-tests"),
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    whenReady: appWhenReadyMock,
    isPackaged: false,
    name: "Tyrum",
    getVersion: vi.fn(() => "0.1.0"),
  },
  BrowserWindow: browserWindowMock,
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
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
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
  shell: {
    openExternal: vi.fn(async () => {}),
  },
}));

vi.mock("../src/main/background-mode.js", () => ({
  BackgroundModeController: backgroundModeControllerMock,
  setBackgroundModeController: vi.fn(),
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

describe("main window recreation for background callbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    appHandlers.clear();
    browserWindowInstances.length = 0;
    backgroundControllerDepsRef.current = null;
    appOnMock.mockClear();
    appQuitMock.mockClear();
    appWhenReadyMock.mockClear();
    appRequestSingleInstanceLockMock.mockClear();
    appSetAppUserModelIdMock.mockClear();
    backgroundModeControllerMock.mockClear();
    browserWindowMock.mockClear();
    ipcMainHandleMock.mockClear();
    menuBuildFromTemplateMock.mockClear();
    menuSetApplicationMenuMock.mockClear();
    nativeThemeOnMock.mockClear();
    registerConfigIpcMock.mockClear();
    registerGatewayIpcMock.mockClear();
    registerNodeIpcMock.mockClear();
    registerUpdateIpcMock.mockClear();
    configExistsMock.mockClear();
    loadConfigMock.mockClear();
    startEmbeddedGatewayFromConfigMock.mockClear();
    loadWindowStateMock.mockClear();
    captureWindowStateMock.mockClear();
    ensureVisibleBoundsMock.mockClear();
    saveWindowStateMock.mockClear();
  });

  it("recreates the window when a background show request arrives after close", async () => {
    await import("../src/main/index.js");
    await Promise.resolve();

    expect(browserWindowInstances).toHaveLength(1);
    const firstWindow = browserWindowInstances[0];
    firstWindow.readyToShowHandler?.();
    firstWindow.handlers.get("closed")?.();

    backgroundControllerDepsRef.current?.onShowMainWindow();

    expect(browserWindowMock).toHaveBeenCalledTimes(2);
    const recreatedWindow = browserWindowInstances[1];
    expect(recreatedWindow.show).not.toHaveBeenCalled();
    expect(recreatedWindow.focus).not.toHaveBeenCalled();

    recreatedWindow.readyToShowHandler?.();

    expect(recreatedWindow.show).toHaveBeenCalledTimes(1);
    expect(recreatedWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("queues navigation until the recreated window is ready", async () => {
    await import("../src/main/index.js");
    await Promise.resolve();

    expect(browserWindowInstances).toHaveLength(1);
    browserWindowInstances[0].handlers.get("closed")?.();

    backgroundControllerDepsRef.current?.onRequestNavigate({ pageId: "connection" });

    expect(browserWindowMock).toHaveBeenCalledTimes(2);
    const recreatedWindow = browserWindowInstances[1];
    expect(recreatedWindow.webContents.send).not.toHaveBeenCalledWith(
      "navigation:request",
      expect.anything(),
    );

    recreatedWindow.readyToShowHandler?.();

    expect(recreatedWindow.webContents.send).toHaveBeenCalledWith("navigation:request", {
      pageId: "connection",
    });
  });
});
