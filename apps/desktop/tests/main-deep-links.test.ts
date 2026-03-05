import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

const {
  appHandlers,
  appOnMock,
  appWhenReadyMock,
  appRequestSingleInstanceLockMock,
  appGetPathMock,
  appSetAppUserModelIdMock,
  browserWindowMock,
  browserWindowOnceMock,
  browserWindowFocusMock,
  ipcMainHandlers,
  ipcMainHandleMock,
  readyToShowHandlers,
  webContentsSendMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  nativeThemeOnMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  configExistsMock,
  loadConfigMock,
  loadWindowStateMock,
  saveWindowStateMock,
  captureWindowStateMock,
  ensureVisibleBoundsMock,
} = vi.hoisted(() => {
  const appHandlersInner = new Map<string, (...args: unknown[]) => void>();
  const ipcMainHandlersInner = new Map<string, (...args: unknown[]) => unknown>();
  const readyToShowHandlersInner: Array<() => void> = [];

  const appOnMockInner = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlersInner.set(event, handler);
  });
  const appWhenReadyMockInner = vi.fn(() => Promise.resolve());
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appGetPathMockInner = vi.fn(() => "/tmp/tyrum-desktop-tests");
  const appSetAppUserModelIdMockInner = vi.fn();

  const webContentsSendMockInner = vi.fn();
  const browserWindowFocusMockInner = vi.fn();
  const browserWindowOnceMockInner = vi.fn((event: string, handler: () => void) => {
    if (event === "ready-to-show") {
      readyToShowHandlersInner.push(handler);
    }
  });

  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      once: browserWindowOnceMockInner,
      show: vi.fn(),
      focus: browserWindowFocusMockInner,
      isDestroyed: vi.fn(() => false),
      webContents: {
        on: vi.fn(),
        isDestroyed: vi.fn(() => false),
        send: webContentsSendMockInner,
        setWindowOpenHandler: vi.fn(),
      },
    };
  });

  const ipcMainHandleMockInner = vi.fn(
    (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcMainHandlersInner.set(channel, handler);
    },
  );

  const menuBuildFromTemplateMockInner = vi.fn(() => ({}));
  const menuSetApplicationMenuMockInner = vi.fn();
  const nativeThemeOnMockInner = vi.fn();

  const registerConfigIpcMockInner = vi.fn();
  const registerGatewayIpcMockInner = vi.fn(() => ({ stop: vi.fn() }));
  const registerNodeIpcMockInner = vi.fn();
  const registerUpdateIpcMockInner = vi.fn();

  const configExistsMockInner = vi.fn(() => true);
  const loadConfigMockInner = vi.fn(() => ({ mode: "remote" }));

  const loadWindowStateMockInner = vi.fn(() => null);
  const saveWindowStateMockInner = vi.fn();
  const captureWindowStateMockInner = vi.fn();
  const ensureVisibleBoundsMockInner = vi.fn((bounds: unknown) => bounds);

  return {
    appHandlers: appHandlersInner,
    appOnMock: appOnMockInner,
    appWhenReadyMock: appWhenReadyMockInner,
    appRequestSingleInstanceLockMock: appRequestSingleInstanceLockMockInner,
    appGetPathMock: appGetPathMockInner,
    appSetAppUserModelIdMock: appSetAppUserModelIdMockInner,
    browserWindowMock: browserWindowMockInner,
    browserWindowOnceMock: browserWindowOnceMockInner,
    browserWindowFocusMock: browserWindowFocusMockInner,
    ipcMainHandlers: ipcMainHandlersInner,
    ipcMainHandleMock: ipcMainHandleMockInner,
    readyToShowHandlers: readyToShowHandlersInner,
    webContentsSendMock: webContentsSendMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    nativeThemeOnMock: nativeThemeOnMockInner,
    registerConfigIpcMock: registerConfigIpcMockInner,
    registerGatewayIpcMock: registerGatewayIpcMockInner,
    registerNodeIpcMock: registerNodeIpcMockInner,
    registerUpdateIpcMock: registerUpdateIpcMockInner,
    configExistsMock: configExistsMockInner,
    loadConfigMock: loadConfigMockInner,
    loadWindowStateMock: loadWindowStateMockInner,
    saveWindowStateMock: saveWindowStateMockInner,
    captureWindowStateMock: captureWindowStateMockInner,
    ensureVisibleBoundsMock: ensureVisibleBoundsMockInner,
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: vi.fn(),
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    getPath: appGetPathMock,
  },
  BrowserWindow: browserWindowMock,
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
  startEmbeddedGatewayFromConfig: vi.fn(async () => ({
    status: "running",
    port: 8788,
  })),
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

async function withArgv<T>(argv: string[], run: () => T | Promise<T>): Promise<T> {
  const originalArgv = process.argv;
  Object.defineProperty(process, "argv", {
    value: argv,
    writable: true,
  });

  try {
    return await run();
  } finally {
    Object.defineProperty(process, "argv", {
      value: originalArgv,
      writable: true,
    });
  }
}

function getHandler(eventName: string): (...args: unknown[]) => void {
  const handler = appHandlers.get(eventName);
  expect(handler).toBeTypeOf("function");
  return handler as (...args: unknown[]) => void;
}

describe("main process deep links", () => {
  beforeEach(() => {
    vi.resetModules();
    appHandlers.clear();
    ipcMainHandlers.clear();
    readyToShowHandlers.length = 0;
    webContentsSendMock.mockClear();
    browserWindowMock.mockClear();
    browserWindowOnceMock.mockClear();
    browserWindowFocusMock.mockClear();
    ipcMainHandleMock.mockClear();
    menuBuildFromTemplateMock.mockClear();
    menuSetApplicationMenuMock.mockClear();
    nativeThemeOnMock.mockReset();
    registerConfigIpcMock.mockClear();
    registerGatewayIpcMock.mockClear();
    registerNodeIpcMock.mockClear();
    registerUpdateIpcMock.mockClear();
    configExistsMock.mockReset();
    loadConfigMock.mockReset();
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "remote" });
  });

  it("stores a startup deep link and exposes it via deeplink:consume", async () => {
    await withArgv(["electron", "tyrum://open?x=1"], async () => {
      await import("../src/main/index.js");
      await Promise.resolve();

      const consume = ipcMainHandlers.get("deeplink:consume");
      expect(consume).toBeTypeOf("function");

      expect(consume?.({} as unknown)).toBe("tyrum://open?x=1");
      expect(consume?.({} as unknown)).toBeNull();
    });
  });

  it("forwards macOS open-url events to the renderer", async () => {
    await import("../src/main/index.js");
    await Promise.resolve();

    const readyToShow = readyToShowHandlers[0];
    expect(readyToShow).toBeTypeOf("function");
    readyToShow?.();

    const openUrl = getHandler("open-url");
    const event = { preventDefault: vi.fn() };

    openUrl(event as unknown, "tyrum://open?x=1");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(webContentsSendMock).toHaveBeenCalledWith("deeplink:open", "tyrum://open?x=1");
  });

  it("forwards argv deep links received via second-instance to the renderer", async () => {
    await import("../src/main/index.js");
    await Promise.resolve();

    const readyToShow = readyToShowHandlers[0];
    expect(readyToShow).toBeTypeOf("function");
    readyToShow?.();

    const secondInstance = getHandler("second-instance");
    secondInstance({}, ["electron", "tyrum://open?x=1"], "/tmp");

    expect(webContentsSendMock).toHaveBeenCalledWith("deeplink:open", "tyrum://open?x=1");
  });
});
