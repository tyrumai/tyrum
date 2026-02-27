import { beforeEach, describe, expect, it, vi } from "vitest";

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
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
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

  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appOnMock = vi.fn();
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const shellOpenExternalMock = vi.fn(async () => {});
  const menuBuildFromTemplateMock = vi.fn(() => ({}) as never);
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

  return {
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
