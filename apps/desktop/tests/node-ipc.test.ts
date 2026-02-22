import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { BrowserWindow } from "electron";

const { ipcMainHandleMock, registeredHandlers, sendMock, testState, decryptTokenMock } =
  vi.hoisted(() => ({
    ipcMainHandleMock: vi.fn(),
    registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    sendMock: vi.fn(),
    decryptTokenMock: vi.fn(() => "admin-token"),
    testState: {
      mode: "remote" as "embedded" | "remote",
      remoteWsUrl: "ws://example.com/ws",
    },
  }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

class MockNodeRuntime {
  static instances: MockNodeRuntime[] = [];
  public connect = vi.fn();
  public disconnect = vi.fn();
  public respondToConsent = vi.fn();
  public callbacks: {
    onStatusChange: (status: { connected: boolean; code?: number; reason?: string }) => void;
  };

  constructor(
    _config: unknown,
    _permissions: unknown,
    callbacks: { onStatusChange: (status: { connected: boolean; code?: number; reason?: string }) => void },
  ) {
    this.callbacks = callbacks;
    MockNodeRuntime.instances.push(this);
  }

  registerProvider(): void {
    // noop
  }
}

vi.mock("../src/main/node-runtime.js", () => ({
  NodeRuntime: MockNodeRuntime,
}));

vi.mock("../src/main/ipc/window-sender.js", () => ({
  createWindowSender: () => ({
    setWindow: vi.fn(),
    send: sendMock,
  }),
}));

vi.mock("../src/main/config/store.js", () => ({
  loadConfig: vi.fn(() => ({
    version: 1,
    mode: testState.mode,
    remote: {
      wsUrl: testState.remoteWsUrl,
      tokenRef: "enc:remote-token",
    },
    embedded: {
      port: 8788,
      dbPath: "/tmp/test-gateway.db",
      tokenRef: "enc:embedded-token",
    },
    permissions: { profile: "balanced", overrides: {} },
    // Keep capabilities disabled to avoid instantiating native providers in unit tests.
    capabilities: { desktop: false, playwright: false, cli: false, http: false },
    cli: { allowedCommands: [], allowedWorkingDirs: [] },
    web: { allowedDomains: [], headless: true },
  })),
}));

vi.mock("../src/main/config/permissions.js", () => ({
  resolvePermissions: vi.fn(() => ({
    playwright: false,
    cli: false,
    playwrightDomainRestricted: true,
    cliAllowlistEnforced: true,
  })),
}));

vi.mock("../src/main/config/token-store.js", () => ({
  decryptToken: decryptTokenMock,
}));

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  ensureEmbeddedGatewayToken: vi.fn(() => "embedded-admin-token"),
  startEmbeddedGatewayFromConfig: vi.fn(async () => {}),
}));

function deriveExpectedEnrollmentToken(token: string): string {
  return createHash("sha256")
    .update(`tyrum-node-enrollment-v1|${token}`, "utf-8")
    .digest("hex");
}

describe("registerNodeIpc", () => {
  beforeEach(() => {
    vi.resetModules();
    MockNodeRuntime.instances = [];
    registeredHandlers.clear();
    sendMock.mockReset();
    decryptTokenMock.mockReset();
    decryptTokenMock.mockImplementation(() => "admin-token");
    testState.mode = "remote";
    testState.remoteWsUrl = "ws://example.com/ws";
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    });
  });

  it("tries derived enrollment token first and falls back to raw token on unauthorized", async () => {
    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerNodeIpc(windowStub);

    const connectHandler = registeredHandlers.get("node:connect");
    expect(connectHandler).toBeDefined();

    await connectHandler!({} as never);

    expect(MockNodeRuntime.instances).toHaveLength(1);
    const instance = MockNodeRuntime.instances[0]!;

    const expectedDerived = deriveExpectedEnrollmentToken("admin-token");
    expect(instance.connect).toHaveBeenCalledWith("ws://example.com/ws", expectedDerived);

    // Simulate the gateway rejecting the derived token.
    instance.callbacks.onStatusChange({ connected: false, code: 4001, reason: "unauthorized" });

    // Should retry once with the raw token.
    expect(instance.connect).toHaveBeenCalledWith("ws://example.com/ws", "admin-token");
    expect(instance.connect).toHaveBeenCalledTimes(2);
  });
});

