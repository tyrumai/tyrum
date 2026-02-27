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
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const readyToShowHandlers: Array<() => void> = [];

  const appOnMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlers.set(event, handler);
  });
  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appGetPathMock = vi.fn(() => "/tmp/tyrum-desktop-tests");
  const appSetAppUserModelIdMock = vi.fn();

  const webContentsSendMock = vi.fn();
  const browserWindowFocusMock = vi.fn();
  const browserWindowOnceMock = vi.fn((event: string, handler: () => void) => {
    if (event === "ready-to-show") {
      readyToShowHandlers.push(handler);
    }
  });

  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      once: browserWindowOnceMock,
      show: vi.fn(),
      focus: browserWindowFocusMock,
      isDestroyed: vi.fn(() => false),
      webContents: {
        on: vi.fn(),
        isDestroyed: vi.fn(() => false),
        send: webContentsSendMock,
        setWindowOpenHandler: vi.fn(),
      },
    };
  });

  const ipcMainHandleMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMainHandlers.set(channel, handler);
  });

  const menuBuildFromTemplateMock = vi.fn(() => ({}));
  const menuSetApplicationMenuMock = vi.fn();
  const nativeThemeOnMock = vi.fn();

  const registerConfigIpcMock = vi.fn();
  const registerGatewayIpcMock = vi.fn(() => ({ stop: vi.fn() }));
  const registerNodeIpcMock = vi.fn();
  const registerUpdateIpcMock = vi.fn();

  const configExistsMock = vi.fn(() => true);
  const loadConfigMock = vi.fn(() => ({ mode: "remote" }));

  const loadWindowStateMock = vi.fn(() => null);
  const saveWindowStateMock = vi.fn();
  const captureWindowStateMock = vi.fn();
  const ensureVisibleBoundsMock = vi.fn((bounds: unknown) => bounds);

  return {
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
