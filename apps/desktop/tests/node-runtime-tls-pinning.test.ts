import { describe, expect, it, vi } from "vitest";

const { ctorSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
}));

vi.mock("@tyrum/transport-sdk/node", () => {
  class TyrumClient {
    on = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();

    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }

  return {
    TyrumClient,
  };
});

vi.mock("@tyrum/client/node", () => ({
  createManagedNodeClientLifecycle: vi.fn((input: { client: unknown; providers?: unknown[] }) => ({
    client: input.client,
    connect: vi.fn(),
    publishCapabilityState: vi.fn(),
    dispose: vi.fn(),
  })),
}));

describe("NodeRuntime remote TLS pinning", () => {
  it(
    "passes remote.tlsCertFingerprint256/tlsAllowSelfSigned through to TyrumClient",
    { timeout: 15_000 },
    async () => {
      vi.resetModules();

      const { NodeRuntime } = await import("../src/main/node-runtime.js");
      const { resolvePermissions } = await import("../src/main/config/permissions.js");
      const { DEFAULT_CONFIG } = await import("../src/main/config/schema.js");

      const runtime = new NodeRuntime(
        {
          ...DEFAULT_CONFIG,
          mode: "remote",
          remote: {
            ...DEFAULT_CONFIG.remote,
            tlsCertFingerprint256: "AA:BB",
            tlsAllowSelfSigned: true,
          },
        },
        resolvePermissions("balanced", {}),
        {
          onStatusChange: vi.fn(),
          onConsentRequest: vi.fn(),
          onPlanUpdate: vi.fn(),
          onLog: vi.fn(),
        },
      );

      runtime.connect("wss://localhost:8788/ws", "test-token");

      expect(ctorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tlsCertFingerprint256: "AA:BB",
          tlsAllowSelfSigned: true,
        }),
      );
    },
  );

  it(
    "connects the desktop runtime as a node even when legacy config has device.enabled=false",
    { timeout: 15_000 },
    async () => {
      vi.resetModules();

      const { NodeRuntime } = await import("../src/main/node-runtime.js");
      const { resolvePermissions } = await import("../src/main/config/permissions.js");
      const { DEFAULT_CONFIG } = await import("../src/main/config/schema.js");

      const runtime = new NodeRuntime(
        {
          ...DEFAULT_CONFIG,
          device: {
            ...DEFAULT_CONFIG.device,
            enabled: false,
          },
        },
        resolvePermissions("balanced", {}),
        {
          onStatusChange: vi.fn(),
          onConsentRequest: vi.fn(),
          onPlanUpdate: vi.fn(),
          onLog: vi.fn(),
        },
      );

      runtime.connect("ws://localhost:8788/ws", "test-token");

      expect(ctorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "node",
          device: expect.objectContaining({
            publicKey: expect.any(String),
          }),
        }),
      );
    },
  );
});
