import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { ipcMainHandleMock, registeredHandlers } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

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

vi.mock("../src/main/providers/desktop-provider.js", () => ({
  DesktopProvider: vi.fn(),
}));

vi.mock("../src/main/providers/playwright-provider.js", () => ({
  PlaywrightProvider: vi.fn(),
}));

vi.mock("../src/main/providers/cli-provider.js", () => ({
  CliProvider: vi.fn(),
}));

vi.mock("../src/main/providers/backends/nutjs-desktop-backend.js", () => ({
  NutJsDesktopBackend: vi.fn(),
}));

vi.mock("../src/main/providers/backends/real-playwright-backend.js", () => ({
  RealPlaywrightBackend: vi.fn(() => ({
    close: vi.fn(),
  })),
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
    NodeRuntime: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      registerProvider: vi.fn(),
      respondToConsent: vi.fn(),
    })),
  };
});

describe("node-ipc", () => {
  beforeEach(() => {
    vi.resetModules();
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

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerNodeIpc(windowStub);

    expect(registeredHandlers.has("node:connect")).toBe(true);
    expect(registeredHandlers.has("node:disconnect")).toBe(true);
    expect(registeredHandlers.has("consent:respond")).toBe(true);
  });

  it("registerNodeIpc is idempotent — does not register handlers twice", async () => {
    const { registerNodeIpc } = await import("../src/main/ipc/node-ipc.js");

    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    registerNodeIpc(windowStub);
    const firstCallCount = ipcMainHandleMock.mock.calls.length;

    registerNodeIpc(windowStub);
    expect(ipcMainHandleMock.mock.calls.length).toBe(firstCallCount);
  });

  it("shutdownNodeResources resolves without error", async () => {
    const { shutdownNodeResources } = await import("../src/main/ipc/node-ipc.js");

    await expect(shutdownNodeResources()).resolves.toBeUndefined();
  });
});
