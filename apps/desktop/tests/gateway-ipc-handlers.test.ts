import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { ipcMainHandleMock, registeredHandlers, testState } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  testState: {
    port: 8080,
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
    mode: "embedded",
    embedded: {
      port: testState.port,
      dbPath: "/tmp/test-gateway.db",
      tokenRef: "enc:token",
    },
    remote: {
      wsUrl: "ws://127.0.0.1:8080/ws",
      tokenRef: "enc:remote-token",
    },
  })),
  saveConfig: vi.fn(),
}));

vi.mock("../src/main/config/token-store.js", () => ({
  decryptToken: vi.fn(() => "token"),
  generateToken: vi.fn(() => "generated-token"),
  encryptToken: vi.fn((token: string) => `enc:${token}`),
}));

vi.mock("../src/main/gateway-bin-path.js", () => ({
  resolveGatewayBinPath: vi.fn(() => "/tmp/mock-gateway-bin.mjs"),
}));

describe("registerGatewayIpc status snapshot flow", () => {
  beforeEach(() => {
    vi.resetModules();
    testState.port = 8080;
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    });
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
      port: 8080,
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
});
