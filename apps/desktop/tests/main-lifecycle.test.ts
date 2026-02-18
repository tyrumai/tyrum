import { describe, expect, it, vi } from "vitest";

const {
  appHandlers,
  appOnMock,
  appQuitMock,
  appWhenReadyMock,
  browserWindowMock,
  registerConfigIpcMock,
  registerGatewayIpcMock,
  registerNodeIpcMock,
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
  const registerNodeIpcMock = vi.fn();
  const registerConfigIpcMock = vi.fn();
  const shutdownNodeResourcesMock = vi.fn(async () => {});

  return {
    appHandlers,
    appOnMock,
    appQuitMock,
    appWhenReadyMock,
    browserWindowMock,
    registerConfigIpcMock,
    registerGatewayIpcMock,
    registerNodeIpcMock,
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
}));

vi.mock("../src/main/ipc/node-ipc.js", () => ({
  registerNodeIpc: registerNodeIpcMock,
  shutdownNodeResources: shutdownNodeResourcesMock,
}));

vi.mock("../src/main/ipc/config-ipc.js", () => ({
  registerConfigIpc: registerConfigIpcMock,
}));

await import("../src/main/index.js");

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
});
