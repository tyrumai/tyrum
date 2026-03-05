import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

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
  const ipcMainHandleMockInner = vi.fn();

  let nativeThemeUpdatedCallback: (() => void) | undefined;
  const nativeThemeOnMockInner = vi.fn((event: string, cb: () => void) => {
    if (event === "updated") {
      nativeThemeUpdatedCallback = cb;
    }
  });

  const menuBuildFromTemplateMockInner = vi.fn(() => ({}) as never);
  const menuSetApplicationMenuMockInner = vi.fn();

  const webContentsOnMock = vi.fn();
  const setWindowOpenHandlerMock = vi.fn();
  const webContentsSendMockInner = vi.fn();

  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: webContentsSendMockInner,
        isDestroyed: vi.fn(() => false),
        on: webContentsOnMock,
        setWindowOpenHandler: setWindowOpenHandlerMock,
      },
    };
  });

  const appWhenReadyMockInner = vi.fn(() => Promise.resolve());
  const appOnMockInner = vi.fn();
  const appQuitMockInner = vi.fn();
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appSetAppUserModelIdMockInner = vi.fn();
  const appGetPathMockInner = vi.fn(() => "/tmp/tyrum-desktop-tests");

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

  return {
    appGetPathMock: appGetPathMockInner,
    appOnMock: appOnMockInner,
    appQuitMock: appQuitMockInner,
    appRequestSingleInstanceLockMock: appRequestSingleInstanceLockMockInner,
    appSetAppUserModelIdMock: appSetAppUserModelIdMockInner,
    appWhenReadyMock: appWhenReadyMockInner,
    browserWindowMock: browserWindowMockInner,
    ipcMainHandleMock: ipcMainHandleMockInner,
    nativeThemeOnMock: nativeThemeOnMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    registerConfigIpcMock: registerConfigIpcMockInner,
    registerGatewayIpcMock: registerGatewayIpcMockInner,
    registerNodeIpcMock: registerNodeIpcMockInner,
    registerUpdateIpcMock: registerUpdateIpcMockInner,
    webContentsSendMock: webContentsSendMockInner,
    getNativeThemeUpdatedCallback: () => nativeThemeUpdatedCallback,
    configExistsMock: configExistsMockInner,
    loadConfigMock: loadConfigMockInner,
    startEmbeddedGatewayFromConfigMock: startEmbeddedGatewayFromConfigMockInner,
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
