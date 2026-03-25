import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockGatewayManager,
  createOkResponse,
  getRegisteredHandler as getHandler,
  registerGatewayIpcForTest,
  resetGatewayIpcForTest,
  expectConnection,
} from "./gateway-ipc-handlers.test-helpers.js";

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
  existsSyncMock,
} = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  saveConfigMock: vi.fn(),
  configExistsMock: vi.fn(() => true),
  decryptTokenMock: vi.fn(() => "tyrum-token.v1.embedded.token"),
  generateTokenMock: vi.fn(() => "generated-token"),
  encryptTokenMock: vi.fn((token: string) => `enc:${token}`),
  undiciFetchMock: vi.fn(async () => createOkResponse()),
  existsSyncMock: vi.fn(),
  testState: {
    port: 8788,
    mode: "embedded" as "embedded" | "remote",
    embeddedDbPath: "/tmp/test-gateway.db",
    embeddedTokenRef: "enc:token",
    remoteWsUrl: "ws://127.0.0.1:8788/ws",
    remoteTokenRef: "enc:remote-token",
    remoteTlsCertFingerprint256: "",
    remoteTlsAllowSelfSigned: false,
  },
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: existsSyncMock };
});

vi.mock("electron", () => ({ ipcMain: { handle: ipcMainHandleMock } }));

vi.mock("undici", () => {
  class Agent {
    destroy = vi.fn(async () => {});
  }
  return { Agent, fetch: undiciFetchMock };
});

vi.mock("../src/main/gateway-manager.js", () => ({ GatewayManager: MockGatewayManager }));

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: vi.fn(() => ({
    mode: testState.mode,
    embedded: {
      port: testState.port,
      dbPath: testState.embeddedDbPath,
      tokenRef: testState.embeddedTokenRef,
    },
    remote: {
      wsUrl: testState.remoteWsUrl,
      tokenRef: testState.remoteTokenRef,
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
  resolveGatewayBin: vi.fn(() => ({ path: "/tmp/mock-gateway-bin.mjs", source: "monorepo" })),
  resolveGatewayBinPath: vi.fn(() => "/tmp/mock-gateway-bin.mjs"),
}));

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  return getHandler(registeredHandlers, channel);
}

function expectEmbeddedConnectionToken(connection: unknown, token: string): void {
  expectConnection(connection, {
    mode: "embedded",
    wsUrl: "ws://127.0.0.1:8788/ws",
    httpBaseUrl: "http://127.0.0.1:8788/",
    token,
  });
}

describe("registerGatewayIpc handlers", () => {
  beforeEach(async () => {
    await resetGatewayIpcForTest();
    testState.port = 8788;
    testState.mode = "embedded";
    testState.embeddedDbPath = "/tmp/test-gateway.db";
    testState.embeddedTokenRef = "enc:token";
    testState.remoteWsUrl = "ws://127.0.0.1:8788/ws";
    testState.remoteTokenRef = "enc:remote-token";
    testState.remoteTlsCertFingerprint256 = "";
    testState.remoteTlsAllowSelfSigned = false;
    saveConfigMock.mockReset();
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(true);
    decryptTokenMock.mockReset();
    decryptTokenMock.mockImplementation(() => "tyrum-token.v1.embedded.token");
    generateTokenMock.mockReset();
    generateTokenMock.mockImplementation(() => "generated-token");
    encryptTokenMock.mockReset();
    encryptTokenMock.mockImplementation((token: string) => `enc:${token}`);
    existsSyncMock.mockReset();
    existsSyncMock.mockImplementation(() => false);
    undiciFetchMock.mockReset();
    undiciFetchMock.mockImplementation(async () => createOkResponse());
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
  });

  it("keeps reporting running status after start when status is requested later", async () => {
    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    await registerGatewayIpcForTest(sentEvents);
    const startHandler = getRegisteredHandler("gateway:start");
    const statusHandler = getRegisteredHandler("gateway:status");

    const startResult = await startHandler!({} as never);
    expect(startResult).toEqual({ status: "running", port: 8788 });

    testState.port = 9090;
    const remountSnapshot = await statusHandler!({} as never);
    expect(remountSnapshot).toEqual({ status: "running", port: 9090 });
    expect(sentEvents).toContainEqual({
      channel: "status:change",
      payload: { gatewayStatus: "running" },
    });
  });

  it("mirrors embedded gateway logs to the main-process console when TYRUM_DEBUG=1", async () => {
    const previousDebug = process.env["TYRUM_DEBUG"];
    process.env["TYRUM_DEBUG"] = "1";
    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { manager } = await registerGatewayIpcForTest(sentEvents);
      const mgr = manager as MockGatewayManager;

      mgr.emit("log", {
        level: "info",
        message: '{"msg":"planner debug line"}',
        timestamp: "2026-03-15T12:00:00.000Z",
      });

      expect(logSpy).toHaveBeenCalledWith(
        '[embedded-gateway 2026-03-15T12:00:00.000Z] {"msg":"planner debug line"}',
      );
      expect(sentEvents).toContainEqual({
        channel: "log:entry",
        payload: {
          source: "gateway",
          level: "info",
          message: '{"msg":"planner debug line"}',
          timestamp: "2026-03-15T12:00:00.000Z",
        },
      });
    } finally {
      logSpy.mockRestore();
      if (previousDebug === undefined) delete process.env["TYRUM_DEBUG"];
      else process.env["TYRUM_DEBUG"] = previousDebug;
    }
  });

  it("does not mirror embedded gateway logs to console without TYRUM_DEBUG=1", async () => {
    const previousDebug = process.env["TYRUM_DEBUG"];
    delete process.env["TYRUM_DEBUG"];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { manager } = await registerGatewayIpcForTest();
      const mgr = manager as MockGatewayManager;

      mgr.emit("log", {
        level: "info",
        message: '{"msg":"planner debug line"}',
        timestamp: "2026-03-15T12:00:00.000Z",
      });

      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      if (previousDebug === undefined) delete process.env["TYRUM_DEBUG"];
      else process.env["TYRUM_DEBUG"] = previousDebug;
    }
  });

  it("returns embedded auth and display UI URLs", async () => {
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectConnection(connection, {
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "tyrum-token.v1.embedded.token",
    });
  });

  it("uses the legacy embedded gateway dbPath when it exists and no override is configured", async () => {
    const prevHome = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = "/tmp/tyrum-home";
    try {
      testState.embeddedDbPath = "";
      const legacyDbPath = join("/tmp/tyrum-home", "gateway", "gateway.db");
      existsSyncMock.mockImplementation((path) => path === legacyDbPath);

      const { manager } = await registerGatewayIpcForTest();
      const mgr = manager as MockGatewayManager;
      const handler = getRegisteredHandler("gateway:operator-connection");
      await handler!({} as never);

      expect(mgr.lastStartOptions).toEqual(
        expect.objectContaining({
          dbPath: legacyDbPath,
          gatewayBin: "/tmp/mock-gateway-bin.mjs",
          gatewayBinSource: "monorepo",
        }),
      );
    } finally {
      if (prevHome === undefined) {
        delete process.env["TYRUM_HOME"];
      } else {
        process.env["TYRUM_HOME"] = prevHome;
      }
    }
  });

  it("rejects operator connection when the desktop is not configured yet", async () => {
    configExistsMock.mockReturnValue(false);
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    await expect(handler!({} as never)).rejects.toThrow("not configured");
  });

  it("recovers embedded token from the startup bootstrap token when decryption fails", async () => {
    decryptTokenMock.mockImplementation(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });
    const { manager } = await registerGatewayIpcForTest();
    const mgr = manager as MockGatewayManager;
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectEmbeddedConnectionToken(connection, "tyrum-token.v1.bootstrap.token");
    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(mgr.issueDefaultTenantAdminTokenCalls).toBe(0);
    expect(encryptTokenMock).toHaveBeenCalledWith("tyrum-token.v1.bootstrap.token");
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embedded: expect.objectContaining({ tokenRef: "enc:tyrum-token.v1.bootstrap.token" }),
      }),
    );
  });

  it("persists the embedded startup bootstrap token on first launch when tokenRef is missing", async () => {
    testState.embeddedTokenRef = "";
    const { manager } = await registerGatewayIpcForTest();
    const mgr = manager as MockGatewayManager;
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectEmbeddedConnectionToken(connection, "tyrum-token.v1.bootstrap.token");
    expect(mgr.issueDefaultTenantAdminTokenCalls).toBe(0);
    expect(encryptTokenMock).toHaveBeenCalledWith("tyrum-token.v1.bootstrap.token");
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        embedded: expect.objectContaining({ tokenRef: "enc:tyrum-token.v1.bootstrap.token" }),
      }),
    );
  });

  it("falls back to offline token issuance after startup when no bootstrap token is available", async () => {
    testState.embeddedTokenRef = "";
    const { manager } = await registerGatewayIpcForTest();
    const mgr = manager as MockGatewayManager;
    mgr.bootstrapToken = undefined;
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectEmbeddedConnectionToken(connection, "tyrum-token.v1.issued.token");
    expect(mgr.startCalls).toBe(1);
    expect(mgr.issueDefaultTenantAdminTokenCalls).toBe(1);
    expect(mgr.callSequence).toEqual(["start", "issueDefaultTenantAdminToken"]);
    expect(encryptTokenMock).toHaveBeenCalledWith("tyrum-token.v1.issued.token");
  });

  it("accepts opaque embedded gateway tokens", async () => {
    decryptTokenMock.mockImplementationOnce(() => "opaque-embedded-token");
    const { ensureEmbeddedGatewayToken } = await import("../src/main/ipc/gateway-ipc.js");
    const { loadConfig } = await import("../src/main/config/store.js");
    expect(ensureEmbeddedGatewayToken(loadConfig())).toBe("opaque-embedded-token");
  });

  it("uses the provisioned embedded token when the saved token is missing", async () => {
    const previousGatewayToken = process.env["GATEWAY_TOKEN"];
    process.env["GATEWAY_TOKEN"] = "opaque-provisioned-token";
    testState.embeddedTokenRef = "";

    try {
      const { manager } = await registerGatewayIpcForTest();
      const mgr = manager as MockGatewayManager;
      mgr.bootstrapToken = undefined;
      const handler = getRegisteredHandler("gateway:operator-connection");
      const connection = await handler!({} as never);
      expectConnection(connection, {
        mode: "embedded",
        wsUrl: "ws://127.0.0.1:8788/ws",
        httpBaseUrl: "http://127.0.0.1:8788/",
        token: "opaque-provisioned-token",
      });
      expect(mgr.issueDefaultTenantAdminTokenCalls).toBe(0);
      expect(encryptTokenMock).toHaveBeenCalledWith("opaque-provisioned-token");
    } finally {
      if (previousGatewayToken === undefined) delete process.env["GATEWAY_TOKEN"];
      else process.env["GATEWAY_TOKEN"] = previousGatewayToken;
    }
  });

  it("restarts the embedded gateway and reissues a token when a running session has lost it", async () => {
    testState.embeddedTokenRef = "";
    const { manager } = await registerGatewayIpcForTest();
    const mgr = manager as MockGatewayManager;
    mgr.status = "running";
    mgr.bootstrapToken = undefined;

    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectConnection(connection, {
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "tyrum-token.v1.issued.token",
    });
    expect(mgr.stopCalls).toBe(1);
    expect(mgr.startCalls).toBe(1);
    expect(mgr.issueDefaultTenantAdminTokenCalls).toBe(1);
  });

  it("does not rotate embedded token when the gateway is already running", async () => {
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    const first = await handler!({} as never);
    expectConnection(first, {
      mode: "embedded",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "tyrum-token.v1.embedded.token",
    });
    decryptTokenMock.mockImplementationOnce(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });
    const second = await handler!({} as never);
    expect(second).toEqual(first);
    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("does not rotate embedded token when resolving operator connection after embedded gateway start", async () => {
    const { resolveOperatorConnection, startEmbeddedGatewayFromConfig } =
      await registerGatewayIpcForTest();
    const { loadConfig } = await import("../src/main/config/store.js");
    await startEmbeddedGatewayFromConfig();
    decryptTokenMock.mockImplementationOnce(() => {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    });
    const connection = resolveOperatorConnection(loadConfig());
    expect(connection.token).toBe("tyrum-token.v1.embedded.token");
    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("converts remote websocket URL to HTTPS base URL", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "wss://remote.example/ws";
    decryptTokenMock.mockImplementation((tokenRef: string) =>
      tokenRef === "enc:remote-token"
        ? "tyrum-token.v1.remote.token"
        : "tyrum-token.v1.embedded.token",
    );
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectConnection(connection, {
      mode: "remote",
      wsUrl: "wss://remote.example/ws",
      httpBaseUrl: "https://remote.example/",
      token: "tyrum-token.v1.remote.token",
    });
  });

  it("accepts opaque remote gateway tokens", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "ws://remote.example/ws";
    decryptTokenMock.mockImplementation((tokenRef: string) =>
      tokenRef === "enc:remote-token"
        ? "0123456789abcdef0123456789abcdef"
        : "tyrum-token.v1.embedded.token",
    );
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    const connection = await handler!({} as never);
    expectConnection(connection, {
      mode: "remote",
      wsUrl: "ws://remote.example/ws",
      httpBaseUrl: "http://remote.example/",
      token: "0123456789abcdef0123456789abcdef",
    });
  });

  it("rejects non-websocket remote wsUrl values", async () => {
    testState.mode = "remote";
    testState.remoteWsUrl = "https://remote.example/ws";
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:operator-connection");
    await expect(handler!({} as never)).rejects.toThrow("expected ws:// or wss://");
  });

  it("proxies HTTP requests to the configured gateway base URL", async () => {
    const fetchMock = vi.fn(async () => createOkResponse());
    vi.stubGlobal("fetch", fetchMock);
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:http-fetch");
    const result = await handler!({} as never, {
      url: "http://127.0.0.1:8788/status",
      init: { method: "GET", headers: { authorization: "Bearer token" }, redirect: "follow" },
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
    const globalFetchMock = vi.fn(
      async () => new Response("unexpected global fetch", { status: 200 }),
    );
    vi.stubGlobal("fetch", globalFetchMock);
    undiciFetchMock.mockImplementation(async () => createOkResponse());
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:http-fetch");
    const result = await handler!({} as never, {
      url: "https://127.0.0.1:8788/status",
      init: { method: "GET", headers: { authorization: "Bearer token" }, redirect: "follow" },
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
    const fetchMock = vi.fn(async () => createOkResponse());
    vi.stubGlobal("fetch", fetchMock);
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:http-fetch");
    const result = await handler!({} as never, {
      url: "http://127.0.0.1:8788/status",
      init: { method: "GET", headers: { authorization: "Bearer token" }, redirect: "follow" },
    });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptTokenMock).not.toHaveBeenCalled();
    expect(generateTokenMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("rejects HTTP proxy requests that include cookies", async () => {
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:http-fetch");
    await expect(
      handler!({} as never, {
        url: "http://127.0.0.1:8788/status",
        init: { method: "GET", headers: { cookie: "tyrum_admin_token=secret" } },
      }),
    ).rejects.toThrow("Cookie header is not allowed");
  });

  it("rejects HTTP proxy requests to other origins", async () => {
    await registerGatewayIpcForTest();
    const handler = getRegisteredHandler("gateway:http-fetch");
    await expect(
      handler!({} as never, {
        url: "https://evil.example/status",
        init: { method: "GET" },
      }),
    ).rejects.toThrow("Only the configured gateway origin is allowed");
  });
});
