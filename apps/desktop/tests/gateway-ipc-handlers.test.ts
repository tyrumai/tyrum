import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const {
  ipcMainHandleMock,
  registeredHandlers,
  testState,
  saveConfigMock,
  decryptTokenMock,
  generateTokenMock,
  encryptTokenMock,
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  saveConfigMock: vi.fn(),
  decryptTokenMock: vi.fn(() => "token"),
  generateTokenMock: vi.fn(() => "generated-token"),
  encryptTokenMock: vi.fn((token: string) => `enc:${token}`),
  testState: {
    port: 8788,
    mode: "embedded" as "embedded" | "remote",
    remoteWsUrl: "ws://127.0.0.1:8788/ws",
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

class MockGatewayManager extends EventEmitter {
  public status: "stopped" | "starting" | "running" | "error" = "stopped";

  async start(): Promise<void> {
    this.status = "running";
    this.emit("status-change", "running");
  }

  async stop(): Promise<void> {
    this.status = "stopped";
    this.emit("status-change", "stopped");
  }
}

vi.mock("../src/main/gateway-manager.js", () => ({
  GatewayManager: MockGatewayManager,
}));

vi.mock("../src/main/config/store.js", () => ({
  loadConfig: vi.fn(() => ({
    mode: testState.mode,
    embedded: {
      port: testState.port,
      dbPath: "/tmp/test-gateway.db",
      tokenRef: "enc:token",
    },
    remote: {
      wsUrl: testState.remoteWsUrl,
      tokenRef: "enc:remote-token",
    },
  })),
  saveConfig: saveConfigMock,
}));

vi.mock("../src/main/config/token-store.js", () => ({
  decryptToken: decryptTokenMock,
  generateToken: generateTokenMock,
  encryptToken: encryptTokenMock,
}));

vi.mock("../src/main/gateway-bin-path.js", () => ({
  resolveGatewayBinPath: vi.fn(() => "/tmp/mock-gateway-bin.mjs"),
}));

describe("registerGatewayIpc handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    testState.port = 8788;
    testState.mode = "embedded";
    testState.remoteWsUrl = "ws://127.0.0.1:8788/ws";
    saveConfigMock.mockReset();
    decryptTokenMock.mockReset();
    decryptTokenMock.mockImplementation(() => "token");
    generateTokenMock.mockReset();
    generateTokenMock.mockImplementation(() => "generated-token");
    encryptTokenMock.mockReset();
    encryptTokenMock.mockImplementation((token: string) => `enc:${token}`);
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
  });

  it("keeps reporting running status after start when status is requested later", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sentEvents.push({ channel, payload });
        },
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const startHandler = registeredHandlers.get("gateway:start");
    const statusHandler = registeredHandlers.get("gateway:status");
    expect(startHandler).toBeDefined();
    expect(statusHandler).toBeDefined();

    const startResult = await startHandler!({} as never);
    expect(startResult).toEqual({
      status: "running",
      port: 8788,
    });

    // Simulate elapsed time + tab remount where the renderer asks for a fresh status snapshot.
    testState.port = 9090;
    const remountSnapshot = await statusHandler!({} as never);
    expect(remountSnapshot).toEqual({
      status: "running",
      port: 9090,
    });

    expect(sentEvents).toContainEqual({
      channel: "status:change",
      payload: { gatewayStatus: "running" },
    });
  });

  it("returns embedded auth and display UI URLs", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const uiUrlsHandler = registeredHandlers.get("gateway:ui-urls");
    expect(uiUrlsHandler).toBeDefined();

    const urls = await uiUrlsHandler!({} as never);
    expect(urls).toEqual({
      embedUrl: "http://127.0.0.1:8788/app/auth?token=token&next=%2Fapp",
      displayUrl: "http://127.0.0.1:8788/app",
      externalUrl: "http://127.0.0.1:8788/app/auth?token=token&next=%2Fapp",
    });
  });

  it("rotates embedded token when persisted token cannot be decrypted", async () => {
    decryptTokenMock.mockImplementationOnce(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const uiUrlsHandler = registeredHandlers.get("gateway:ui-urls");
    expect(uiUrlsHandler).toBeDefined();

    const urls = await uiUrlsHandler!({} as never);
    expect(urls).toEqual({
      embedUrl: "http://127.0.0.1:8788/app/auth?token=generated-token&next=%2Fapp",
      displayUrl: "http://127.0.0.1:8788/app",
      externalUrl: "http://127.0.0.1:8788/app/auth?token=generated-token&next=%2Fapp",
    });
    expect(generateTokenMock).toHaveBeenCalledTimes(1);
    expect(encryptTokenMock).toHaveBeenCalledWith("generated-token");
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embedded: expect.objectContaining({
          tokenRef: "enc:generated-token",
        }),
      }),
    );
  });

  it("returns onboarding URL targets when requested", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const uiUrlsHandler = registeredHandlers.get("gateway:ui-urls");
    expect(uiUrlsHandler).toBeDefined();

    const urls = await uiUrlsHandler!({} as never, { startOnboarding: true });
    expect(urls).toEqual({
      embedUrl: "http://127.0.0.1:8788/app/auth?token=token&next=%2Fapp%2Fonboarding%2Fstart",
      displayUrl: "http://127.0.0.1:8788/app/onboarding/start",
      externalUrl: "http://127.0.0.1:8788/app/auth?token=token&next=%2Fapp%2Fonboarding%2Fstart",
    });
  });

  it("switches to remote mode, stops gateway, and emits navigation update", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => {
          sentEvents.push({ channel, payload });
        },
      },
    } as unknown as BrowserWindow;

    const manager = registerGatewayIpc(windowStub);
    await manager.start();

    const modeHandler = registeredHandlers.get("onboarding:select-mode");
    expect(modeHandler).toBeDefined();

    const result = await modeHandler!({} as never, "remote");
    expect(result).toEqual({ mode: "remote" });
    expect(saveConfigMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "remote" }));
    expect(sentEvents).toContainEqual({
      channel: "status:change",
      payload: {
        gatewayStatus: "stopped",
        navigateTo: { page: "connection", tab: "remote" },
      },
    });
  });

  it("converts remote websocket URL to HTTPS app URL", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "wss://remote.example/ws";

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const uiUrlsHandler = registeredHandlers.get("gateway:ui-urls");
    expect(uiUrlsHandler).toBeDefined();

    const urls = await uiUrlsHandler!({} as never);
    expect(urls).toEqual({
      embedUrl: "https://remote.example/app",
      displayUrl: "https://remote.example/app",
      externalUrl: "https://remote.example/app",
    });
  });
});
