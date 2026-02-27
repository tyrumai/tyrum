import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  appOnMock,
  appQuitMock,
  browserWindowMock,
  browserWindowOnceMock,
  browserWindowShowMock,
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
} = vi.hoisted(() => {
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
      once: browserWindowOnceMock,
      show: browserWindowShowMock,
      webContents: {
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
    browserWindowOnceMock,
    browserWindowShowMock,
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

describe("main window ready-to-show", () => {
  beforeEach(() => {
    vi.resetModules();
    readyToShowHandlers.length = 0;
    browserWindowMock.mockClear();
    browserWindowOnceMock.mockClear();
    browserWindowShowMock.mockClear();
    webContentsOnMock.mockReset();
    setWindowOpenHandlerMock.mockReset();
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
});
