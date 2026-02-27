import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appHandlers,
  appOnMock,
  appQuitMock,
  appRequestSingleInstanceLockMock,
  appSetAppUserModelIdMock,
  appWhenReadyMock,
  browserWindowMock,
  ipcMainHandleMock,
  nativeThemeOnMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  startEmbeddedGatewayFromConfigMock,
  configExistsMock,
  loadConfigMock,
  registerNodeIpcMock,
  registerUpdateIpcMock,
  shutdownNodeResourcesMock,
} = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcMainHandleMock = vi.fn();
  const nativeThemeOnMock = vi.fn();
  const appQuitMock = vi.fn();
  const appRequestSingleInstanceLockMock = vi.fn(() => true);
  const appSetAppUserModelIdMock = vi.fn();
  const appOnMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    appHandlers.set(event, handler);
  });
  const appWhenReadyMock = vi.fn(() => new Promise<void>(() => {}));
  const browserWindowMock = vi.fn(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
  }));
  const registerGatewayIpcMock = vi.fn(() => ({ stop: vi.fn() }));
  const startEmbeddedGatewayFromConfigMock = vi.fn(async () => ({
    status: "running",
    port: 8788,
  }));
  const configExistsMock = vi.fn(() => true);
  const loadConfigMock = vi.fn(() => ({ mode: "embedded" }));
  const registerNodeIpcMock = vi.fn();
  const registerConfigIpcMock = vi.fn();
  const registerUpdateIpcMock = vi.fn();
  const shutdownNodeResourcesMock = vi.fn(async () => {});

  return {
    appHandlers,
    appOnMock,
    appQuitMock,
    appRequestSingleInstanceLockMock,
    appSetAppUserModelIdMock,
    appWhenReadyMock,
    browserWindowMock,
    ipcMainHandleMock,
    nativeThemeOnMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    startEmbeddedGatewayFromConfigMock,
    configExistsMock,
    loadConfigMock,
    registerNodeIpcMock,
    registerUpdateIpcMock,
    shutdownNodeResourcesMock,
  };
});

vi.mock("electron", () => ({
  app: {
    whenReady: appWhenReadyMock,
    on: appOnMock,
    quit: appQuitMock,
    requestSingleInstanceLock: appRequestSingleInstanceLockMock,
    setAppUserModelId: appSetAppUserModelIdMock,
    getPath: vi.fn(() => "/tmp/tyrum-desktop-tests"),
  },
  BrowserWindow: browserWindowMock,
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() }) as never),
    setApplicationMenu: vi.fn(),
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

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  registerGatewayIpc: registerGatewayIpcMock,
  startEmbeddedGatewayFromConfig: startEmbeddedGatewayFromConfigMock,
}));

vi.mock("../src/main/ipc/node-ipc.js", () => ({
  registerNodeIpc: registerNodeIpcMock,
  shutdownNodeResources: shutdownNodeResourcesMock,
}));

vi.mock("../src/main/ipc/config-ipc.js", () => ({
  registerConfigIpc: registerConfigIpcMock,
}));

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: loadConfigMock,
}));

vi.mock("../src/main/ipc/update-ipc.js", () => ({
  registerUpdateIpc: registerUpdateIpcMock,
}));

async function importMainModule(): Promise<typeof import("../src/main/index.js")> {
  vi.resetModules();
  appHandlers.clear();
  appOnMock.mockClear();
  appQuitMock.mockClear();
  appWhenReadyMock.mockClear();
  appRequestSingleInstanceLockMock.mockReset();
  appRequestSingleInstanceLockMock.mockReturnValue(true);
  appSetAppUserModelIdMock.mockClear();
  return import("../src/main/index.js");
}

async function withPlatform<T>(platform: NodeJS.Platform, run: () => T | Promise<T>): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    writable: true,
  });

  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  }
}

function getHandler(eventName: string): (...args: unknown[]) => void {
  const handler = appHandlers.get(eventName);
  expect(handler).toBeTypeOf("function");
  return handler as (...args: unknown[]) => void;
}

describe("main process lifecycle", () => {
  beforeEach(() => {
    startEmbeddedGatewayFromConfigMock.mockClear();
    configExistsMock.mockReset();
    loadConfigMock.mockReset();
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "embedded" });
  });

  it("registers app lifecycle handlers", async () => {
    await importMainModule();

    expect(appRequestSingleInstanceLockMock).toHaveBeenCalledTimes(1);
    expect(appWhenReadyMock).toHaveBeenCalledTimes(1);
    expect(appHandlers.has("window-all-closed")).toBe(true);
    expect(appHandlers.has("activate")).toBe(true);
    expect(appHandlers.has("before-quit")).toBe(true);
  });

  it("quits immediately when the single-instance lock is not acquired", async () => {
    vi.resetModules();
    appHandlers.clear();
    appQuitMock.mockClear();
    appWhenReadyMock.mockClear();
    appRequestSingleInstanceLockMock.mockReset();
    appRequestSingleInstanceLockMock.mockReturnValue(false);

    await import("../src/main/index.js");

    expect(appQuitMock).toHaveBeenCalledTimes(1);
    expect(appWhenReadyMock).not.toHaveBeenCalled();
    expect(appHandlers.size).toBe(0);
  });

  it("sets the Windows AppUserModelId before creating windows", async () => {
    await withPlatform("win32", () => importMainModule());

    expect(appSetAppUserModelIdMock).toHaveBeenCalledTimes(1);
    expect(appSetAppUserModelIdMock).toHaveBeenCalledWith("net.tyrum.desktop");
  });

  it("quits when all windows are closed on non-macOS", async () => {
    await importMainModule();

    const onWindowAllClosed = getHandler("window-all-closed");
    appQuitMock.mockClear();

    await withPlatform("linux", () => {
      onWindowAllClosed();
    });

    expect(appQuitMock).toHaveBeenCalledTimes(1);
  });

  it("does not quit when all windows are closed on macOS", async () => {
    await importMainModule();

    const onWindowAllClosed = getHandler("window-all-closed");
    appQuitMock.mockClear();

    await withPlatform("darwin", () => {
      onWindowAllClosed();
    });

    expect(appQuitMock).not.toHaveBeenCalled();
  });

  it("auto-starts embedded gateway when configured mode is embedded", async () => {
    const mainModule = await importMainModule();
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "embedded" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).toHaveBeenCalledTimes(1);
  });

  it("auto-starts embedded gateway on first launch regardless of saved mode", async () => {
    const mainModule = await importMainModule();
    configExistsMock.mockReturnValue(false);
    loadConfigMock.mockReturnValue({ mode: "remote" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start embedded gateway when config exists and mode is remote", async () => {
    const mainModule = await importMainModule();
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "remote" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).not.toHaveBeenCalled();
  });
});
