import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { ipcMainHandleMock, registeredHandlers } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

function createWindowStub(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: vi.fn(),
    },
  } as unknown as BrowserWindow;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return { promise, resolve, reject };
}

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock("../src/main/config/store.js", () => ({
  loadConfig: vi.fn(() => ({
    mode: "embedded",
    embedded: { port: 8788, dbPath: "/tmp/test.db", tokenRef: "enc:tok" },
    remote: { wsUrl: "ws://127.0.0.1:8788/ws", tokenRef: "" },
    permissions: { profile: "default", overrides: {} },
    capabilities: { desktop: false, playwright: false, cli: false, http: false },
    cli: { allowedCommands: [], allowedWorkingDirs: [] },
    web: { allowedDomains: [], headless: true },
  })),
}));

vi.mock("../src/main/config/permissions.js", () => ({
  resolvePermissions: vi.fn(() => ({
    cli: false,
    cliAllowlistEnforced: true,
    playwright: false,
    playwrightDomainRestricted: true,
  })),
}));

vi.mock("../src/main/config/token-store.js", () => ({
  decryptToken: vi.fn(() => "test-token"),
}));

vi.mock("@tyrum/desktop-node", () => ({
  AtSpiDesktopA11yBackend: vi.fn(),
  DesktopProvider: vi.fn(),
  NutJsDesktopBackend: vi.fn(),
  getTesseractOcrEngine: vi.fn(() => ({ recognize: vi.fn() })),
}));

vi.mock("../src/main/providers/playwright-provider.js", () => ({
  PlaywrightProvider: vi.fn(),
}));

vi.mock("../src/main/providers/cli-provider.js", () => ({
  CliProvider: vi.fn(),
}));

vi.mock("../src/main/providers/backends/real-playwright-backend.js", () => ({
  RealPlaywrightBackend: vi.fn(function () {
    return { close: vi.fn() };
  }),
}));

vi.mock("../src/main/ipc/window-sender.js", () => ({
  createWindowSender: vi.fn(() => ({
    setWindow: vi.fn(),
    send: vi.fn(),
  })),
}));

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  ensureEmbeddedGatewayToken: vi.fn(() => "embedded-token"),
  startEmbeddedGatewayFromConfig: vi.fn(async () => {}),
}));

vi.mock("../src/main/node-runtime.js", () => {
  return {
    NodeRuntime: vi.fn(function () {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        registerProvider: vi.fn(),
        respondToConsent: vi.fn(),
      };
    }),
  };
});

describe("node-ipc", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
  });

  it("registerNodeIpc registers expected IPC handlers", async () => {
    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");

    const windowStub = createWindowStub();

    registerNodeIpc(windowStub);

    expect(registeredHandlers.has("node:connect")).toBe(true);
    expect(registeredHandlers.has("node:disconnect")).toBe(true);
    expect(registeredHandlers.has("node:get-status")).toBe(true);
  });

  it("registerNodeIpc is idempotent — does not register handlers twice", async () => {
    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");

    const windowStub = createWindowStub();

    registerNodeIpc(windowStub);
    const firstCallCount = ipcMainHandleMock.mock.calls.length;

    registerNodeIpc(windowStub);
    expect(ipcMainHandleMock.mock.calls.length).toBe(firstCallCount);
  });

  it("shutdownNodeResources resolves without error", async () => {
    const { shutdownNodeResources } = await import("../src/main/ipc/node-ipc.js");

    await expect(shutdownNodeResources()).resolves.toBeUndefined();
  });

  it("connects in embedded mode and reports node status changes", async () => {
    const { loadConfig } = await import("../src/main/config/store.js");
    (loadConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mode: "embedded",
      embedded: { port: 8788, dbPath: "/tmp/test.db", tokenRef: "enc:tok" },
      remote: { wsUrl: "ws://127.0.0.1:8788/ws", tokenRef: "" },
      permissions: { profile: "default", overrides: {} },
      capabilities: { desktop: false, playwright: false, cli: false, http: false },
      cli: { allowedCommands: [], allowedWorkingDirs: [] },
      web: { allowedDomains: [], headless: true },
    });

    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");
    const windowStub = createWindowStub();
    registerNodeIpc(windowStub);

    const connectHandler = registeredHandlers.get("node:connect");
    expect(connectHandler).toBeDefined();
    const result = await (connectHandler as () => Promise<{ status: string }>)();
    expect(result.status).toBe("connecting");

    const { NodeRuntime } = await import("../src/main/node-runtime.js");
    const NodeRuntimeMock = NodeRuntime as unknown as ReturnType<typeof vi.fn>;
    expect(NodeRuntimeMock).toHaveBeenCalledTimes(1);

    const runtimeInstance = NodeRuntimeMock.mock.results[0]?.value as
      | { connect: (wsUrl: string, token: string) => void }
      | undefined;
    expect(runtimeInstance).toBeDefined();
    expect(runtimeInstance?.connect).toHaveBeenCalledWith(
      "ws://127.0.0.1:8788/ws",
      "embedded-token",
    );

    const { startEmbeddedGatewayFromConfig, ensureEmbeddedGatewayToken } =
      await import("../src/main/ipc/gateway-ipc.js");
    expect(startEmbeddedGatewayFromConfig).toHaveBeenCalledTimes(1);
    expect(ensureEmbeddedGatewayToken).toHaveBeenCalledTimes(1);

    const { createWindowSender } = await import("../src/main/ipc/window-sender.js");
    const sender = (createWindowSender as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)
      ?.value as { send: (...args: unknown[]) => void } | undefined;
    expect(sender).toBeDefined();

    const callbacks = NodeRuntimeMock.mock.calls[0]?.[2] as
      | { onStatusChange: (status: { connected: boolean; code?: number }) => void }
      | undefined;
    expect(callbacks).toBeDefined();

    callbacks?.onStatusChange({ connected: true });
    callbacks?.onStatusChange({ connected: false, code: 999 });
    callbacks?.onStatusChange({ connected: false, code: 1000 });

    expect(sender?.send).toHaveBeenCalledWith(
      "status:change",
      expect.objectContaining({ nodeStatus: "connected" }),
    );
    expect(sender?.send).toHaveBeenCalledWith(
      "status:change",
      expect.objectContaining({ nodeStatus: "error" }),
    );
    expect(sender?.send).toHaveBeenCalledWith(
      "status:change",
      expect.objectContaining({ nodeStatus: "disconnected" }),
    );
  });

  it("connects in remote mode and registers enabled providers", async () => {
    const { loadConfig } = await import("../src/main/config/store.js");
    (loadConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mode: "remote",
      embedded: { port: 8788, dbPath: "/tmp/test.db", tokenRef: "enc:tok" },
      remote: { wsUrl: "ws://gateway.example/ws", tokenRef: "enc:remote" },
      permissions: { profile: "default", overrides: {} },
      capabilities: { desktop: true, playwright: true, cli: true, http: false },
      cli: { allowedCommands: ["echo"], allowedWorkingDirs: ["/tmp"] },
      web: { allowedDomains: ["example.com"], headless: true },
    });

    const { resolvePermissions } = await import("../src/main/config/permissions.js");
    (resolvePermissions as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cli: true,
      cliAllowlistEnforced: true,
      playwright: true,
      playwrightDomainRestricted: true,
    });

    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");
    registerNodeIpc(createWindowStub());

    const connectHandler = registeredHandlers.get("node:connect");
    expect(connectHandler).toBeDefined();
    await (connectHandler as () => Promise<{ status: string }>)();

    const { startEmbeddedGatewayFromConfig } = await import("../src/main/ipc/gateway-ipc.js");
    expect(startEmbeddedGatewayFromConfig).not.toHaveBeenCalled();

    const { decryptToken } = await import("../src/main/config/token-store.js");
    expect(decryptToken).toHaveBeenCalledTimes(1);

    const { NodeRuntime } = await import("../src/main/node-runtime.js");
    const NodeRuntimeMock = NodeRuntime as unknown as ReturnType<typeof vi.fn>;
    const runtimeInstance = NodeRuntimeMock.mock.results.at(-1)?.value as
      | {
          connect: (wsUrl: string, token: string) => void;
          registerProvider: (...args: unknown[]) => void;
        }
      | undefined;
    expect(runtimeInstance).toBeDefined();
    expect(runtimeInstance?.connect).toHaveBeenCalledWith("ws://gateway.example/ws", "test-token");

    const { DesktopProvider } = await import("@tyrum/desktop-node");
    const { PlaywrightProvider } = await import("../src/main/providers/playwright-provider.js");
    const { CliProvider } = await import("../src/main/providers/cli-provider.js");
    expect(DesktopProvider).toHaveBeenCalledTimes(1);
    expect(PlaywrightProvider).toHaveBeenCalledTimes(1);
    expect(CliProvider).toHaveBeenCalledTimes(1);

    expect(runtimeInstance?.registerProvider).toHaveBeenCalledTimes(3);

    const { RealPlaywrightBackend } =
      await import("../src/main/providers/backends/real-playwright-backend.js");
    expect(RealPlaywrightBackend).toHaveBeenCalledWith({ headless: true });
  });

  it("cleans up the prior runtime and playwright backend when reconnecting", async () => {
    const { loadConfig } = await import("../src/main/config/store.js");
    (loadConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mode: "remote",
      embedded: { port: 8788, dbPath: "/tmp/test.db", tokenRef: "enc:tok" },
      remote: { wsUrl: "ws://gateway.example/ws", tokenRef: "enc:remote" },
      permissions: { profile: "default", overrides: {} },
      capabilities: { desktop: false, playwright: true, cli: false, http: false },
      cli: { allowedCommands: [], allowedWorkingDirs: [] },
      web: { allowedDomains: [], headless: true },
    });

    const { resolvePermissions } = await import("../src/main/config/permissions.js");
    (resolvePermissions as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cli: false,
      cliAllowlistEnforced: true,
      playwright: true,
      playwrightDomainRestricted: true,
    });

    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");
    registerNodeIpc(createWindowStub());

    const connectHandler = registeredHandlers.get("node:connect");
    expect(connectHandler).toBeDefined();

    await (connectHandler as () => Promise<{ status: string }>)();

    const { NodeRuntime } = await import("../src/main/node-runtime.js");
    const NodeRuntimeMock = NodeRuntime as unknown as ReturnType<typeof vi.fn>;
    const firstRuntime = NodeRuntimeMock.mock.results[0]?.value as
      | { disconnect: () => void }
      | undefined;

    const { RealPlaywrightBackend } =
      await import("../src/main/providers/backends/real-playwright-backend.js");
    const RealPlaywrightBackendMock = RealPlaywrightBackend as unknown as ReturnType<typeof vi.fn>;
    const firstBackend = RealPlaywrightBackendMock.mock.results[0]?.value as
      | { close: () => Promise<void> }
      | undefined;

    await (connectHandler as () => Promise<{ status: string }>)();

    expect(firstRuntime?.disconnect).toHaveBeenCalledTimes(1);
    expect(firstBackend?.close).toHaveBeenCalledTimes(1);
  });

  it("ignores stale connect completions after a disconnect wins the race", async () => {
    const { loadConfig } = await import("../src/main/config/store.js");
    (loadConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mode: "embedded",
      embedded: { port: 8788, dbPath: "/tmp/test.db", tokenRef: "enc:tok" },
      remote: { wsUrl: "ws://127.0.0.1:8788/ws", tokenRef: "" },
      permissions: { profile: "default", overrides: {} },
      capabilities: { desktop: false, playwright: false, cli: false, http: false },
      cli: { allowedCommands: [], allowedWorkingDirs: [] },
      web: { allowedDomains: [], headless: true },
    });

    const startDeferred = createDeferred<void>();
    const { startEmbeddedGatewayFromConfig } = await import("../src/main/ipc/gateway-ipc.js");
    (startEmbeddedGatewayFromConfig as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => startDeferred.promise,
    );

    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");
    registerNodeIpc(createWindowStub());

    const connectHandler = registeredHandlers.get("node:connect");
    const disconnectHandler = registeredHandlers.get("node:disconnect");
    expect(connectHandler).toBeDefined();
    expect(disconnectHandler).toBeDefined();

    const connectPromise = (
      connectHandler as () => Promise<{ status: "connecting" | "disconnected" }>
    )();
    await Promise.resolve();
    await Promise.resolve();

    const { NodeRuntime } = await import("../src/main/node-runtime.js");
    const NodeRuntimeMock = NodeRuntime as unknown as ReturnType<typeof vi.fn>;
    const firstRuntime = NodeRuntimeMock.mock.results[0]?.value as
      | { connect: (wsUrl: string, token: string) => void; disconnect: () => void }
      | undefined;
    expect(firstRuntime).toBeDefined();

    await (disconnectHandler as () => Promise<{ status: string }>)();
    startDeferred.resolve();

    await expect(connectPromise).resolves.toHaveProperty("status");
    expect(firstRuntime?.disconnect).toHaveBeenCalledTimes(1);
    expect(firstRuntime?.connect).not.toHaveBeenCalled();
  });

  it("returns node status over IPC", async () => {
    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");
    registerNodeIpc(createWindowStub());

    const statusHandler = registeredHandlers.get("node:get-status");
    expect(statusHandler).toBeDefined();
    expect(
      (statusHandler as () => { status: string; connected: boolean; deviceId: string | null })(),
    ).toEqual({
      status: "disconnected",
      connected: false,
      deviceId: null,
    });
  });
});
