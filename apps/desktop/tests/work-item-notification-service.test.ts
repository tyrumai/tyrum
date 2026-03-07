import { describe, expect, it, vi } from "vitest";

const {
  connectSpy,
  disconnectSpy,
  offSpy,
  ctorSpy,
  resolveOperatorConnectionMock,
  startEmbeddedGatewayFromConfigMock,
  configExistsMock,
} = vi.hoisted(() => ({
  connectSpy: vi.fn(),
  disconnectSpy: vi.fn(),
  offSpy: vi.fn(),
  ctorSpy: vi.fn(),
  resolveOperatorConnectionMock: vi.fn(),
  startEmbeddedGatewayFromConfigMock: vi.fn(async () => ({ status: "running", port: 8788 })),
  configExistsMock: vi.fn(() => true),
}));

vi.mock("electron", () => ({
  Notification: class NotificationMock {
    static isSupported = vi.fn(() => false);
    on = vi.fn();
    show = vi.fn();
  },
}));

vi.mock("@tyrum/operator-core/node", () => {
  class TyrumClient {
    on = vi.fn();
    off = offSpy;
    connect = connectSpy;
    disconnect = disconnectSpy;

    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }

  return {
    TyrumClient,
  };
});

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: vi.fn(() => ({ mode: "remote" })),
}));

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  startEmbeddedGatewayFromConfig: startEmbeddedGatewayFromConfigMock,
  resolveOperatorConnection: resolveOperatorConnectionMock,
}));

describe("WorkItemNotificationService", () => {
  it("does not start when the desktop is not configured yet", async () => {
    vi.resetModules();
    connectSpy.mockReset();
    disconnectSpy.mockReset();
    offSpy.mockReset();
    ctorSpy.mockReset();
    resolveOperatorConnectionMock.mockReset();
    startEmbeddedGatewayFromConfigMock.mockReset();
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(false);

    const { WorkItemNotificationService } = await import("../src/main/work-item-notifications.js");
    const service = new WorkItemNotificationService(() => {});

    await service.start();

    expect(startEmbeddedGatewayFromConfigMock).not.toHaveBeenCalled();
    expect(resolveOperatorConnectionMock).not.toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("allows retrying start after an initial failure", async () => {
    vi.resetModules();
    connectSpy.mockReset();
    disconnectSpy.mockReset();
    offSpy.mockReset();
    ctorSpy.mockReset();
    resolveOperatorConnectionMock.mockReset();
    startEmbeddedGatewayFromConfigMock.mockReset();
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(true);
    resolveOperatorConnectionMock
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockReturnValue({
        mode: "remote",
        wsUrl: "ws://127.0.0.1:8788/ws",
        httpBaseUrl: "http://127.0.0.1:8788/",
        token: "test-token",
        tlsCertFingerprint256: "",
        tlsAllowSelfSigned: false,
      });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { WorkItemNotificationService } =
        await import("../src/main/work-item-notifications.js");
      const service = new WorkItemNotificationService(() => {});

      await service.start();
      await service.start();

      expect(ctorSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("cleans up the client when connect throws", async () => {
    vi.resetModules();
    connectSpy.mockReset();
    disconnectSpy.mockReset();
    offSpy.mockReset();
    ctorSpy.mockReset();
    resolveOperatorConnectionMock.mockReset();
    startEmbeddedGatewayFromConfigMock.mockReset();
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(true);

    connectSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    resolveOperatorConnectionMock.mockReturnValue({
      mode: "remote",
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788/",
      token: "test-token",
      tlsCertFingerprint256: "",
      tlsAllowSelfSigned: false,
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { WorkItemNotificationService } =
        await import("../src/main/work-item-notifications.js");
      const service = new WorkItemNotificationService(() => {});

      await service.start();

      expect(ctorSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(offSpy).toHaveBeenCalledTimes(3);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("does not re-export registerWorkItemNotificationHandlers", async () => {
    vi.resetModules();

    const module = await import("../src/main/work-item-notifications.js");
    expect("registerWorkItemNotificationHandlers" in module).toBe(false);
  });
});
