import { describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";

describe("lifecycle hooks startup gating", () => {
  it("does not auto-fire gateway.start hooks when no worker loop is running", async () => {
    vi.resetModules();

    const fireMock = vi.fn(async () => [] as string[]);

    const logger = {
      child: () => logger,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = {
      kind: "postgres",
      get: async () => undefined,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => undefined,
      transaction: async <T>(fn: (tx: any) => Promise<T>) => await fn(db),
      close: vi.fn(async () => {}),
    };

    vi.doMock("../../src/statestore/postgres.js", () => {
      return {
        PostgresDb: {
          open: vi.fn(async () => db),
        },
      };
    });

    vi.doMock("../../src/modules/config/deployment-config-dal.js", () => {
      return {
        DeploymentConfigDal: class {
          async ensureSeeded(): Promise<{ config: unknown }> {
            return { config: DeploymentConfig.parse({}) };
          }
        },
      };
    });

    vi.doMock("../../src/modules/config/agent-config-dal.js", () => {
      return {
        AgentConfigDal: class {
          async ensureSeeded(): Promise<{ config: unknown }> {
            return { config: {} };
          }
        },
      };
    });

    vi.doMock("../../src/modules/auth/auth-token-service.js", () => {
      return {
        AuthTokenService: class {
          async countActiveSystemTokens(): Promise<number> {
            return 1;
          }
          async countActiveTenantAdminTokens(): Promise<number> {
            return 1;
          }
          async countActiveTenantTokens(): Promise<number> {
            return 1;
          }
        },
      };
    });

    vi.doMock("../../src/modules/secret/create-secret-provider.js", () => {
      return {
        createDbSecretProviderFactory: vi.fn(async () => {
          return {
            keyId: "test",
            secretProviderForTenant: () => ({
              list: async () => [],
              resolve: async () => null,
              store: async () => {
                throw new Error("not implemented");
              },
              revoke: async () => false,
            }),
          };
        }),
      };
    });

    vi.doMock("../../src/modules/hooks/config.js", () => {
      return {
        loadLifecycleHooksFromHome: async () => {
          return [
            {
              hook_key: "hook:550e8400-e29b-41d4-a716-446655440000",
              event: "gateway.start",
              steps: [{ type: "Desktop", args: { op: "screenshot" } }],
            },
          ];
        },
      };
    });

    vi.doMock("../../src/modules/hooks/runtime.js", () => {
      return {
        LifecycleHooksRuntime: class LifecycleHooksRuntime {
          fire = fireMock;
        },
      };
    });

    vi.doMock("../../src/modules/watcher/scheduler.js", () => {
      return {
        WatcherScheduler: class WatcherScheduler {
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock("../../src/modules/artifact/lifecycle.js", () => {
      return {
        ArtifactLifecycleScheduler: class ArtifactLifecycleScheduler {
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock("../../src/modules/backplane/outbox-lifecycle.js", () => {
      return {
        OutboxLifecycleScheduler: class OutboxLifecycleScheduler {
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock("../../src/modules/statestore/lifecycle.js", () => {
      return {
        StateStoreLifecycleScheduler: class StateStoreLifecycleScheduler {
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock("../../src/modules/workboard/signal-scheduler.js", () => {
      return {
        WorkSignalScheduler: class WorkSignalScheduler {
          start(): void {}
          stop(): void {}
        },
      };
    });

    vi.doMock("../../src/modules/observability/otel.js", () => {
      return {
        maybeStartOtel: vi.fn(async () => ({ enabled: false, shutdown: async () => {} })),
      };
    });

    vi.doMock("../../src/container.js", () => {
      return {
        wireContainer: () =>
          ({
            db,
            identityScopeDal: {
              resolveScopeIds: async () => ({
                tenantId: "00000000-0000-4000-8000-000000000001",
                agentId: "00000000-0000-4000-8000-000000000002",
                workspaceId: "00000000-0000-4000-8000-000000000003",
              }),
            },
            channelThreadDal: {},
            memoryDal: {},
            contextReportDal: {},
            secretResolutionAuditDal: {},
            eventLog: {},
            discoveryPipeline: {},
            riskClassifier: {},
            sessionDal: {},
            eventBus: {},
            telegramBot: undefined,
            approvalDal: { respond: async () => null },
            presenceDal: {},
            policySnapshotDal: {},
            policyOverrideDal: {},
            policyService: {},
            nodePairingDal: {},
            watcherProcessor: { start: vi.fn(), stop: vi.fn() },
            canvasDal: {},
            redactionEngine: undefined,
            artifactStore: {},
            modelsDev: { startBackgroundRefresh: vi.fn(), stopBackgroundRefresh: vi.fn() },
            oauthPendingDal: {},
            oauthRefreshLeaseDal: {},
            oauthProviderRegistry: {},
            modelCatalog: {},
            logger,
            config: {
              dbPath: "postgres://user:pass@localhost:5432/db",
              migrationsDir: "/dev/null",
              tyrumHome: "/tmp",
            },
            deploymentConfig: DeploymentConfig.parse({}),
          }) as any,
      };
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitSpy = vi.spyOn(process, "exit");
    const exitCalled = new Promise<void>((resolve) => {
      exitSpy.mockImplementation((() => {
        resolve();
        return undefined as never;
      }) as any);
    });

    const { main } = await import("../../src/index.js");
    await main({ role: "scheduler", db: "postgres://user:pass@localhost:5432/db" });

    process.emit("SIGTERM");
    await exitCalled;

    expect(fireMock).toHaveBeenCalledTimes(0);

    logSpy.mockRestore();
  }, 15_000);
});
