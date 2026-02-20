import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appHandlers,
  appOnMock,
  appQuitMock,
  appWhenReadyMock,
  browserWindowMock,
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
  const appQuitMock = vi.fn();
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
    appWhenReadyMock,
    browserWindowMock,
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
  },
  BrowserWindow: browserWindowMock,
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

const mainModule = await import("../src/main/index.js");

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    writable: true,
  });

  try {
    return run();
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

  it("registers app lifecycle handlers", () => {
    expect(appWhenReadyMock).toHaveBeenCalledTimes(1);
    expect(appHandlers.has("window-all-closed")).toBe(true);
    expect(appHandlers.has("activate")).toBe(true);
    expect(appHandlers.has("before-quit")).toBe(true);
  });

  it("quits when all windows are closed on non-macOS", () => {
    const onWindowAllClosed = getHandler("window-all-closed");
    appQuitMock.mockClear();

    withPlatform("linux", () => {
      onWindowAllClosed();
    });

    expect(appQuitMock).toHaveBeenCalledTimes(1);
  });

  it("does not quit when all windows are closed on macOS", () => {
    const onWindowAllClosed = getHandler("window-all-closed");
    appQuitMock.mockClear();

    withPlatform("darwin", () => {
      onWindowAllClosed();
    });

    expect(appQuitMock).not.toHaveBeenCalled();
  });

  it("auto-starts embedded gateway when configured mode is embedded", async () => {
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "embedded" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).toHaveBeenCalledTimes(1);
  });

  it("auto-starts embedded gateway on first launch regardless of saved mode", async () => {
    configExistsMock.mockReturnValue(false);
    loadConfigMock.mockReturnValue({ mode: "remote" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start embedded gateway when config exists and mode is remote", async () => {
    configExistsMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({ mode: "remote" });

    await mainModule.maybeAutoStartEmbeddedGatewayOnLaunch();

    expect(startEmbeddedGatewayFromConfigMock).not.toHaveBeenCalled();
  });
});
