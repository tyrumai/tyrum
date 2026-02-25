import { afterEach, describe, expect, it, vi } from "vitest";

const { fireMock } = vi.hoisted(() => ({
  fireMock: vi.fn(async () => [] as string[]),
}));

vi.mock("../../src/container.js", () => {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockContainer = {
    db: { kind: "postgres" },
    logger,
    modelsDev: { startBackgroundRefresh: vi.fn(), stopBackgroundRefresh: vi.fn() },
    policyService: {},
    policySnapshotDal: {},
    approvalDal: {},
    presenceDal: {},
    policyOverrideDal: {},
    nodePairingDal: {},
    contextReportDal: {},
    memoryDal: {},
    eventBus: {},
    watcherProcessor: { start: vi.fn(), stop: vi.fn() },
    artifactStore: {},
    redactionEngine: undefined,
    telegramBot: undefined,
  };

  return {
    createContainer: () => mockContainer,
    createContainerAsync: async () => mockContainer,
  };
});

vi.mock("../../src/modules/auth/token-store.js", () => {
  return {
    normalizeScopes: (scopes: string[] | undefined) => {
      if (!Array.isArray(scopes)) return [];
      const normalized = scopes
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
      return [...new Set(normalized)];
    },
    TokenStore: class TokenStore {
      constructor(_home: string) {}
      async initialize(): Promise<string> {
        return "test-token";
      }
    },
  };
});

vi.mock("../../src/modules/secret/create-secret-provider.js", () => {
  return {
    resolveSecretProviderKind: () => "env",
    createSecretProviderFromEnv: async () => ({}),
  };
});

vi.mock("../../src/modules/hooks/config.js", () => {
  return {
    loadLifecycleHooksFromHome: async () => {
      return [
        {
          hook_key: "hook:550e8400-e29b-41d4-a716-446655440000",
          event: "gateway.start",
          steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
        },
      ];
    },
  };
});

vi.mock("../../src/modules/hooks/runtime.js", () => {
  return {
    LifecycleHooksRuntime: class LifecycleHooksRuntime {
      fire = fireMock;
      constructor(_opts: unknown) {}
    },
  };
});

vi.mock("../../src/modules/watcher/scheduler.js", () => {
  return {
    WatcherScheduler: class WatcherScheduler {
      start(): void {}
      stop(): void {}
    },
  };
});

vi.mock("../../src/modules/artifact/lifecycle.js", () => {
  return {
    ArtifactLifecycleScheduler: class ArtifactLifecycleScheduler {
      start(): void {}
      stop(): void {}
    },
  };
});

vi.mock("../../src/modules/observability/otel.js", () => {
  return {
    maybeStartOtel: async () => ({
      enabled: false,
      shutdown: async () => {},
    }),
  };
});

describe("lifecycle hooks startup gating", () => {
  const originalEnv = {
    GATEWAY_DB_PATH: process.env["GATEWAY_DB_PATH"],
  };

  afterEach(() => {
    fireMock.mockClear();
    if (originalEnv.GATEWAY_DB_PATH === undefined) {
      delete process.env["GATEWAY_DB_PATH"];
    } else {
      process.env["GATEWAY_DB_PATH"] = originalEnv.GATEWAY_DB_PATH;
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("does not auto-fire gateway.start hooks when no worker loop is running", async () => {
    process.env["GATEWAY_DB_PATH"] = "postgres://user:pass@localhost:5432/db";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { main } = await import("../../src/index.js");
    await main("scheduler");

    expect(fireMock).toHaveBeenCalledTimes(0);

    logSpy.mockRestore();
  });
});
