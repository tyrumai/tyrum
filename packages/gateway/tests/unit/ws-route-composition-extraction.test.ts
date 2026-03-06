import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

const {
  bindWsConnectionHandlerMock,
  createHandleUpgradeMock,
  createHeartbeatControllerMock,
  stopHeartbeatMock,
} = vi.hoisted(() => ({
  bindWsConnectionHandlerMock: vi.fn(),
  createHandleUpgradeMock: vi.fn(),
  createHeartbeatControllerMock: vi.fn(),
  stopHeartbeatMock: vi.fn(),
}));

vi.mock("../../src/routes/ws/connection-handler.js", () => {
  return { bindWsConnectionHandler: bindWsConnectionHandlerMock };
});

vi.mock("../../src/routes/ws/upgrade.js", () => {
  return { createHandleUpgrade: createHandleUpgradeMock };
});

vi.mock("../../src/routes/ws/heartbeat.js", () => {
  return {
    createHeartbeatController: createHeartbeatControllerMock,
  };
});

describe("WS route composition extraction", () => {
  afterEach(() => {
    bindWsConnectionHandlerMock.mockReset();
    createHandleUpgradeMock.mockReset();
    createHeartbeatControllerMock.mockReset();
    stopHeartbeatMock.mockReset();
    vi.resetModules();
  });

  it("builds the route from extracted heartbeat, connection, and upgrade modules", async () => {
    const connectionManager = new ConnectionManager();
    const authTokens = { authenticate: vi.fn() } as never;
    const protocolDeps = { connectionManager };
    const handleUpgrade = vi.fn();

    createHeartbeatControllerMock.mockReturnValue({ stopHeartbeat: stopHeartbeatMock });
    createHandleUpgradeMock.mockReturnValue(handleUpgrade);

    const { createWsHandler } = await import("../../src/routes/ws.js");
    const handler = createWsHandler({ connectionManager, authTokens, protocolDeps });

    expect(createHeartbeatControllerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionManager,
        cluster: undefined,
        connectionTtlMs: 30_000,
        presenceDal: undefined,
        presenceMaxEntries: 500,
        presenceTtlMs: 60_000,
      }),
    );
    expect(bindWsConnectionHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wss: handler.wss,
        connectionManager,
        authTokens,
        protocolDeps,
      }),
    );
    expect(createHandleUpgradeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wss: handler.wss,
        upgradeRateLimiter: undefined,
        trustedProxies: undefined,
      }),
    );
    expect(handler.handleUpgrade).toBe(handleUpgrade);
    expect(handler.stopHeartbeat).toBe(stopHeartbeatMock);
  });

  it("wires trusted proxies into both upgrade and connection handlers without a rate limiter", async () => {
    const connectionManager = new ConnectionManager();
    const authTokens = { authenticate: vi.fn() } as never;
    const protocolDeps = { connectionManager };

    createHeartbeatControllerMock.mockReturnValue({ stopHeartbeat: stopHeartbeatMock });
    createHandleUpgradeMock.mockReturnValue(vi.fn());

    const { createWsHandler } = await import("../../src/routes/ws.js");
    createWsHandler({
      connectionManager,
      authTokens,
      protocolDeps,
      trustedProxies: "127.0.0.1",
    });

    const upgradeTrustedProxies = createHandleUpgradeMock.mock.calls[0]?.[0]?.trustedProxies as
      | { isTrustedProxy(ip: string): boolean }
      | undefined;
    expect(upgradeTrustedProxies?.isTrustedProxy("127.0.0.1")).toBe(true);

    const connectionTrustedProxies = bindWsConnectionHandlerMock.mock.calls[0]?.[0]
      ?.trustedProxies as { isTrustedProxy(ip: string): boolean } | undefined;
    expect(connectionTrustedProxies?.isTrustedProxy("127.0.0.1")).toBe(true);
  });
});
