import { beforeEach, describe, expect, it, vi } from "vitest";

import "./work-item-notifications.mock.js";

const {
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  appOnMock,
  appQuitMock,
  browserWindowMock,
  menuBuildFromTemplateMock,
  menuSetApplicationMenuMock,
  shellOpenExternalMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  configExistsMock,
  loadConfigMock,
  startEmbeddedGatewayFromConfigMock,
} = vi.hoisted(() => {
  const browserWindowMockInner = vi.fn(function MockBrowserWindow() {
    return {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
  });

  const appWhenReadyMockInner = vi.fn(() => new Promise<void>(() => {}));
  const appOnMockInner = vi.fn();
  const appQuitMockInner = vi.fn();
  const appRequestSingleInstanceLockMockInner = vi.fn(() => true);
  const appSetAppUserModelIdMockInner = vi.fn();
  const shellOpenExternalMockInner = vi.fn(async () => {});
  const menuBuildFromTemplateMockInner = vi.fn(() => ({}) as never);
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

  return {
    appRequestSingleInstanceLockMock: appRequestSingleInstanceLockMockInner,
    appSetAppUserModelIdMock: appSetAppUserModelIdMockInner,
    appWhenReadyMock: appWhenReadyMockInner,
    appOnMock: appOnMockInner,
    appQuitMock: appQuitMockInner,
    browserWindowMock: browserWindowMockInner,
    menuBuildFromTemplateMock: menuBuildFromTemplateMockInner,
    menuSetApplicationMenuMock: menuSetApplicationMenuMockInner,
    shellOpenExternalMock: shellOpenExternalMockInner,
    registerConfigIpcMock: registerConfigIpcMockInner,
    registerGatewayIpcMock: registerGatewayIpcMockInner,
    registerNodeIpcMock: registerNodeIpcMockInner,
    registerUpdateIpcMock: registerUpdateIpcMockInner,
    configExistsMock: configExistsMockInner,
    loadConfigMock: loadConfigMockInner,
    startEmbeddedGatewayFromConfigMock: startEmbeddedGatewayFromConfigMockInner,
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
  },
  BrowserWindow: browserWindowMock,
  Menu: {
    buildFromTemplate: menuBuildFromTemplateMock,
    setApplicationMenu: menuSetApplicationMenuMock,
  },
  shell: {
    openExternal: shellOpenExternalMock,
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

describe("main context menus", () => {
  beforeEach(() => {
    vi.resetModules();
    appOnMock.mockClear();
  });

  it("registers a global webContents context-menu hook", async () => {
    await import("../src/main/index.js");

    expect(appOnMock).toHaveBeenCalledWith("web-contents-created", expect.any(Function));
  });
});
