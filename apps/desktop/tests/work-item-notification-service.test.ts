import { describe, expect, it, vi } from "vitest";

const { connectSpy, ctorSpy, resolveOperatorConnectionMock } = vi.hoisted(() => ({
  connectSpy: vi.fn(),
  ctorSpy: vi.fn(),
  resolveOperatorConnectionMock: vi.fn(),
}));

vi.mock("electron", () => ({
  Notification: class NotificationMock {
    static isSupported = vi.fn(() => false);
    constructor(_options: { title: string; body?: string }) {}
    on = vi.fn();
    show = vi.fn();
  },
}));

vi.mock("@tyrum/client", () => {
  class TyrumClient {
    on = vi.fn();
    off = vi.fn();
    connect = connectSpy;
    disconnect = vi.fn();

    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }

  return {
    TyrumClient,
  };
});

vi.mock("../src/main/config/store.js", () => ({
  loadConfig: vi.fn(() => ({ mode: "remote" })),
}));

vi.mock("../src/main/ipc/gateway-ipc.js", () => ({
  startEmbeddedGatewayFromConfig: vi.fn(async () => ({ status: "running", port: 8788 })),
  resolveOperatorConnection: resolveOperatorConnectionMock,
}));

describe("WorkItemNotificationService", () => {
  it("allows retrying start after an initial failure", async () => {
    vi.resetModules();
    connectSpy.mockReset();
    ctorSpy.mockReset();
    resolveOperatorConnectionMock.mockReset();
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
      });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { WorkItemNotificationService } = await import("../src/main/work-item-notifications.js");
      const service = new WorkItemNotificationService(() => {});

      await service.start();
      await service.start();

      expect(ctorSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

