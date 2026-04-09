import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockGatewayManager,
  createWindowStub,
  getRegisteredHandler as getHandler,
  resetGatewayIpcForTest,
} from "./gateway-ipc-handlers.test-helpers.js";

const { runEmbeddedGatewayTailscaleServeActionMock } = vi.hoisted(() => ({
  runEmbeddedGatewayTailscaleServeActionMock: vi.fn(),
}));

const { ipcMainHandleMock, registeredHandlers, decryptTokenMock, configExistsMock, testState } =
  vi.hoisted(() => ({
    ipcMainHandleMock: vi.fn(),
    registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    decryptTokenMock: vi.fn(() => "tyrum-token.v1.embedded.token"),
    configExistsMock: vi.fn(() => true),
    testState: {
      port: 8788,
      mode: "embedded" as "embedded" | "remote",
      embeddedDbPath: "/tmp/test-gateway.db",
      embeddedTokenRef: "enc:token",
      remoteWsUrl: "ws://127.0.0.1:8788/ws",
      remoteTokenRef: "enc:remote-token",
      remoteTlsCertFingerprint256: "",
    },
  }));

vi.mock("electron", () => ({ ipcMain: { handle: ipcMainHandleMock } }));

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
    },
  })),
}));

vi.mock("../src/main/config/token-store.js", () => ({
  decryptToken: decryptTokenMock,
  encryptToken: vi.fn((token: string) => `enc:${token}`),
  generateToken: vi.fn(() => "generated-token"),
}));

vi.mock("../src/main/gateway-bin-path.js", () => ({
  resolveGatewayBin: vi.fn(() => ({ path: "/tmp/mock-gateway-bin.mjs", source: "monorepo" })),
  resolveGatewayBinPath: vi.fn(() => "/tmp/mock-gateway-bin.mjs"),
}));

vi.mock("../src/main/gateway-tailscale-service.js", () => ({
  runEmbeddedGatewayTailscaleServeAction: runEmbeddedGatewayTailscaleServeActionMock,
}));

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  return getHandler(registeredHandlers, channel);
}

async function registerGatewayIpcForTailscaleTest(): Promise<void> {
  const gatewayIpc = await import("../src/main/ipc/gateway-ipc.js");
  gatewayIpc.registerGatewayIpc(createWindowStub());
}

describe("gateway IPC tailscale handlers", () => {
  beforeEach(async () => {
    await resetGatewayIpcForTest();
    testState.port = 8788;
    testState.mode = "embedded";
    testState.embeddedDbPath = "/tmp/test-gateway.db";
    testState.embeddedTokenRef = "enc:token";
    testState.remoteWsUrl = "ws://127.0.0.1:8788/ws";
    testState.remoteTokenRef = "enc:remote-token";
    testState.remoteTlsCertFingerprint256 = "";
    decryptTokenMock.mockReset();
    decryptTokenMock.mockImplementation(() => "tyrum-token.v1.embedded.token");
    configExistsMock.mockReset();
    configExistsMock.mockImplementation(() => true);
    runEmbeddedGatewayTailscaleServeActionMock.mockReset();
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
  });

  it("returns embedded tailscale serve status through the IPC handler", async () => {
    runEmbeddedGatewayTailscaleServeActionMock.mockResolvedValue({
      adminUrl: "https://login.tailscale.com/admin/machines",
      binaryAvailable: true,
      backendRunning: true,
      backendState: "Running",
      currentPublicBaseUrl: "https://gateway.tailnet.ts.net",
      dnsName: "gateway.tailnet.ts.net",
      gatewayReachable: true,
      gatewayReachabilityReason: null,
      gatewayTarget: "http://127.0.0.1:8788",
      managedStatePresent: true,
      ownership: "managed",
      publicBaseUrlMatches: true,
      publicUrl: "https://gateway.tailnet.ts.net",
      reason: null,
    });

    await registerGatewayIpcForTailscaleTest();
    const handler = getRegisteredHandler("gateway:tailscale-serve-status");
    const status = await handler({} as never);

    expect(runEmbeddedGatewayTailscaleServeActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "status",
        gatewayPort: 8788,
        home: expect.any(String),
        httpBaseUrl: "http://127.0.0.1:8788/",
        token: "tyrum-token.v1.embedded.token",
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        ownership: "managed",
        gatewayReachable: true,
      }),
    );
  });

  it("rejects tailscale serve handlers in remote mode", async () => {
    testState.mode = "remote";
    await registerGatewayIpcForTailscaleTest();
    const handler = getRegisteredHandler("gateway:tailscale-serve-enable");

    await expect(handler({} as never)).rejects.toThrow(
      "Tailscale Serve is available only for the embedded gateway.",
    );
    expect(runEmbeddedGatewayTailscaleServeActionMock).not.toHaveBeenCalled();
  });
});
