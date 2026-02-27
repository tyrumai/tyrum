import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appGetPathMock,
  appOnMock,
  appQuitMock,
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  browserWindowMock,
  ipcMainHandleMock,
  nativeThemeOnMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  webContentsSendMock,
  getNativeThemeUpdatedCallback,
  configExistsMock,
  loadConfigMock,
  startEmbeddedGatewayFromConfigMock,
} = vi.hoisted(() => {
  const ipcMainHandleMock = vi.fn();

  let nativeThemeUpdatedCallback: (() => void) | undefined;
  const nativeThemeOnMock = vi.fn((event: string, cb: () => void) => {
    if (event === "updated") {
      nativeThemeUpdatedCallback = cb;
    }
  });

  const menuBuildFromTemplateMock = vi.fn(() => ({}) as never);
  const menuSetApplicationMenuMock = vi.fn();

  const webContentsOnMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const webContentsSendMock = vi.fn();

  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: webContentsSendMock,
        isDestroyed: vi.fn(() => false),
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
    appGetPathMock,
    appOnMock,
    appQuitMock,
    appRequestSingleInstanceLockMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    browserWindowMock,
    ipcMainHandleMock,
    nativeThemeOnMock,
    menuBuildFromTemplateMock,
    menuSetApplicationMenuMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    registerNodeIpcMock,
    registerUpdateIpcMock,
    webContentsSendMock,
    getNativeThemeUpdatedCallback: () => nativeThemeUpdatedCallback,
    configExistsMock,
    loadConfigMock,
    startEmbeddedGatewayFromConfigMock,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: appGetPathMock,
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
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
  shell: {
    openExternal: vi.fn(async () => {}),
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

vi.mock("../src/main/work-item-notifications.js", () => ({
  WorkItemNotificationService: class WorkItemNotificationService {
    constructor(_openDeepLink: unknown) {}

    start(): Promise<void> {
      return Promise.resolve();
    }

    stop(): void {}
  },
}));

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: loadConfigMock,
}));

describe("main theme IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    appGetPathMock.mockClear();
    ipcMainHandleMock.mockReset();
    nativeThemeOnMock.mockReset();
    menuBuildFromTemplateMock.mockReset();
    menuSetApplicationMenuMock.mockReset();
  });

  it("registers theme handlers and listens for theme updates", async () => {
    await import("../src/main/index.js");

    // Flush the `app.whenReady().then(createWindow)` microtask.
    await Promise.resolve();

    expect(ipcMainHandleMock).toHaveBeenCalledWith("theme:get-state", expect.any(Function));
    expect(nativeThemeOnMock).toHaveBeenCalledWith("updated", expect.any(Function));

    const updated = getNativeThemeUpdatedCallback();
    updated?.();

    expect(webContentsSendMock).toHaveBeenCalledWith("theme:state", {
      colorScheme: "light",
      highContrast: false,
      inverted: false,
      source: "system",
    });
  });
});
