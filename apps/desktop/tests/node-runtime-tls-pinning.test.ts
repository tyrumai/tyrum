import { describe, expect, it, vi } from "vitest";

const { ctorSpy } = vi.hoisted(() => ({
  ctorSpy: vi.fn(),
}));

vi.mock("@tyrum/client", () => {
  class TyrumClient {
    on = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    respondApprovalRequest = vi.fn();

    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  }

  return {
    TyrumClient,
    autoExecute: vi.fn(),
  };
});

describe("NodeRuntime remote TLS pinning", () => {
  it("passes remote.tlsCertFingerprint256 through to TyrumClient", async () => {
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
      }),
    );
  });
});

