import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appGetPathMock,
  appOnMock,
  appQuitMock,
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  browserWindowMock,
  browserWindowMaximizeMock,
  configExistsMock,
  ensureVisibleBoundsMock,
  loadConfigMock,
  loadWindowStateMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  screenGetAllDisplaysMock,
  screenGetPrimaryDisplayMock,
  startEmbeddedGatewayFromConfigMock,
} = vi.hoisted(() => {
  const appWhenReadyMock = vi.fn(() => Promise.resolve());
  const appOnMock = vi.fn();
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const appGetPathMock = vi.fn(() => "/tmp/tyrum-desktop-tests");

  const browserWindowMaximizeMock = vi.fn();
  const browserWindowMock = vi.fn(function MockBrowserWindow() {
    return {
      maximize: browserWindowMaximizeMock,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
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

  return {
    appGetPathMock,
    appOnMock,
    appQuitMock,
    appRequestSingleInstanceLockMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    browserWindowMock,
    browserWindowMaximizeMock,
    configExistsMock,
    ensureVisibleBoundsMock,
    loadConfigMock,
    loadWindowStateMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    registerNodeIpcMock,
    registerUpdateIpcMock,
    screenGetAllDisplaysMock,
    screenGetPrimaryDisplayMock,
    startEmbeddedGatewayFromConfigMock,
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
  captureWindowState: vi.fn(),
  saveWindowState: vi.fn(),
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
    browserWindowMaximizeMock.mockClear();
    loadWindowStateMock.mockClear();
    ensureVisibleBoundsMock.mockClear();
    screenGetAllDisplaysMock.mockClear();
    screenGetPrimaryDisplayMock.mockClear();
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
});
