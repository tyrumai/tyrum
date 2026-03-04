import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const {
  ipcMainHandleMock,
  registeredHandlers,
  testState,
  saveConfigMock,
  configExistsMock,
  decryptTokenMock,
  generateTokenMock,
  encryptTokenMock,
  undiciFetchMock,
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  saveConfigMock: vi.fn(),
  configExistsMock: vi.fn(() => true),
  decryptTokenMock: vi.fn(() => "token"),
  generateTokenMock: vi.fn(() => "generated-token"),
  encryptTokenMock: vi.fn((token: string) => `enc:${token}`),
  undiciFetchMock: vi.fn(async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
  testState: {
    port: 8788,
    mode: "embedded" as "embedded" | "remote",
    remoteWsUrl: "ws://127.0.0.1:8788/ws",
    remoteTlsCertFingerprint256: "",
    remoteTlsAllowSelfSigned: false,
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock("undici", () => {
  class Agent {
    destroy = vi.fn(async () => {});

    constructor(_opts: unknown) {
      // no-op
    }
  }

  return { Agent, fetch: undiciFetchMock };
});

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
  configExists: configExistsMock,
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
      tlsCertFingerprint256: testState.remoteTlsCertFingerprint256,
      tlsAllowSelfSigned: testState.remoteTlsAllowSelfSigned,
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
    testState.remoteTlsCertFingerprint256 = "";
    testState.remoteTlsAllowSelfSigned = false;
    saveConfigMock.mockReset();
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(true);
    decryptTokenMock.mockReset();
    decryptTokenMock.mockImplementation(() => "token");
    generateTokenMock.mockReset();
    generateTokenMock.mockImplementation(() => "generated-token");
    encryptTokenMock.mockReset();
    encryptTokenMock.mockImplementation((token: string) => `enc:${token}`);
    undiciFetchMock.mockReset();
    undiciFetchMock.mockImplementation(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
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

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    const connection = await operatorConnectionHandler!({} as never);
    expect(connection).toEqual({
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    });
  });

  it("rejects operator connection when the desktop is not configured yet", async () => {
    configExistsMock.mockReturnValue(false);
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    await expect(operatorConnectionHandler!({} as never)).rejects.toThrow("not configured");
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

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    const connection = await operatorConnectionHandler!({} as never);
    expect(connection).toEqual({
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "generated-token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
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

  it("does not rotate embedded token when the gateway is already running", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    const first = await operatorConnectionHandler!({} as never);
    expect(first).toEqual({
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "token",
      tlsCertFingerprint256: "",
    });

    decryptTokenMock.mockImplementationOnce(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });

    const second = await operatorConnectionHandler!({} as never);
    expect(second).toEqual(first);

    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("does not rotate embedded token when resolving operator connection after embedded gateway start", async () => {
    const { registerGatewayIpc, resolveOperatorConnection, startEmbeddedGatewayFromConfig } =
      await import("../src/main/ipc/gateway-ipc.js");
    const { loadConfig } = await import("../src/main/config/store.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    await startEmbeddedGatewayFromConfig();

    decryptTokenMock.mockImplementationOnce(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });

    const connection = resolveOperatorConnection(loadConfig());
    expect(connection.token).toBe("token");

    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("converts remote websocket URL to HTTPS base URL", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "wss://remote.example/ws";
    decryptTokenMock.mockImplementation((tokenRef: string) =>
      tokenRef === "enc:remote-token" ? "remote-token" : "token",
    );

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    const connection = await operatorConnectionHandler!({} as never);
    expect(connection).toEqual({
      mode: "remote",
      wsUrl: "wss://remote.example/ws",
      httpBaseUrl: "https://remote.example/",
      token: "remote-token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    });
  });

  it("rejects non-websocket remote wsUrl values", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "https://remote.example/ws";

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const operatorConnectionHandler = registeredHandlers.get("gateway:operator-connection");
    expect(operatorConnectionHandler).toBeDefined();

    await expect(operatorConnectionHandler!({} as never)).rejects.toThrow(
      "expected ws:// or wss://",
    );
  });

  it("proxies HTTP requests to the configured gateway base URL", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const httpFetchHandler = registeredHandlers.get("gateway:http-fetch");
    expect(httpFetchHandler).toBeDefined();

    const result = await httpFetchHandler!({} as never, {
      url: "http://127.0.0.1:8788/status",
      init: {
        method: "GET",
        headers: { authorization: "Bearer token" },
        redirect: "follow",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/status", {
      method: "GET",
      headers: { authorization: "Bearer token" },
      redirect: "manual",
    });

    expect(result).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({ status: "ok" }),
    });
  });

  it("uses undici.fetch for pinned HTTPS proxy requests", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "wss://127.0.0.1:8788/ws";
    testState.remoteTlsCertFingerprint256 = "a".repeat(64);
    testState.remoteTlsAllowSelfSigned = true;

    const globalFetchMock = vi.fn(async () => {
      return new Response("unexpected global fetch", { status: 200 });
    });
    vi.stubGlobal("fetch", globalFetchMock);

    undiciFetchMock.mockImplementation(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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

    const httpFetchHandler = registeredHandlers.get("gateway:http-fetch");
    expect(httpFetchHandler).toBeDefined();

    const result = await httpFetchHandler!({} as never, {
      url: "https://127.0.0.1:8788/status",
      init: {
        method: "GET",
        headers: { authorization: "Bearer token" },
        redirect: "follow",
      },
    });

    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(undiciFetchMock).toHaveBeenCalledWith(
      "https://127.0.0.1:8788/status",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer token" },
        redirect: "manual",
        dispatcher: expect.anything(),
      }),
    );

    expect(result.status).toBe(200);
  });

  it("does not rotate embedded tokens during HTTP proxy requests", async () => {
    decryptTokenMock.mockImplementation(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const httpFetchHandler = registeredHandlers.get("gateway:http-fetch");
    expect(httpFetchHandler).toBeDefined();

    const result = await httpFetchHandler!({} as never, {
      url: "http://127.0.0.1:8788/status",
      init: {
        method: "GET",
        headers: { authorization: "Bearer token" },
        redirect: "follow",
      },
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptTokenMock).not.toHaveBeenCalled();
    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("rejects HTTP proxy requests that include cookies", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const httpFetchHandler = registeredHandlers.get("gateway:http-fetch");
    expect(httpFetchHandler).toBeDefined();

    await expect(
      httpFetchHandler!({} as never, {
        url: "http://127.0.0.1:8788/status",
        init: { method: "GET", headers: { cookie: "tyrum_admin_token=secret" } },
      }),
    ).rejects.toThrow("Cookie header is not allowed");
  });

  it("rejects HTTP proxy requests to other origins", async () => {
    const { registerGatewayIpc } = await import("../src/main/ipc/gateway-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerGatewayIpc(windowStub);

    const httpFetchHandler = registeredHandlers.get("gateway:http-fetch");
    expect(httpFetchHandler).toBeDefined();

    await expect(
      httpFetchHandler!({} as never, {
        url: "https://evil.example/status",
        init: { method: "GET" },
      }),
    ).rejects.toThrow("Only the configured gateway origin is allowed");
  });
});
