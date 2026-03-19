import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";

describe("gateway shutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stops the StateStoreLifecycleScheduler on shutdown", async () => {
    vi.resetModules();

    const watcherStop = vi.fn();
    const artifactStop = vi.fn();
    const outboxStop = vi.fn();
    const stateStoreStart = vi.fn();
    const stateStoreStop = vi.fn();
    const workSignalStop = vi.fn();

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
        loadLifecycleHooksFromHome: async () => [],
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
              dbPath: "postgres://user:pass@localhost:5432/test",
              migrationsDir: "/dev/null",
              tyrumHome: "/tmp",
            },
            deploymentConfig: DeploymentConfig.parse({}),
          }) as any,
      };
    });

    vi.doMock("../../src/modules/watcher/scheduler.js", () => {
      return {
        WatcherScheduler: class {
          start(): void {}
          stop(): void {
            watcherStop();
          }
        },
      };
    });

    vi.doMock("../../src/modules/artifact/lifecycle.js", () => {
      return {
        ArtifactLifecycleScheduler: class {
          start(): void {}
          stop(): void {
            artifactStop();
          }
        },
      };
    });

    vi.doMock("../../src/modules/backplane/outbox-lifecycle.js", () => {
      return {
        OutboxLifecycleScheduler: class {
          start(): void {}
          stop(): void {
            outboxStop();
          }
        },
      };
    });

    vi.doMock("../../src/modules/statestore/lifecycle.js", () => {
      return {
        StateStoreLifecycleScheduler: class {
          start(): void {
            stateStoreStart();
          }
          stop(): void {
            stateStoreStop();
          }
        },
      };
    });

    vi.doMock("../../src/modules/workboard/signal-scheduler.js", () => {
      return {
        WorkSignalScheduler: class {
          start(): void {}
          stop(): void {
            workSignalStop();
          }
        },
      };
    });

    const exitSpy = vi.spyOn(process, "exit");
    const exitCalled = new Promise<void>((resolve) => {
      exitSpy.mockImplementation((() => {
        resolve();
        return undefined as never;
      }) as any);
    });

    const { main } = await import("../../src/index.js");
    await main({ role: "scheduler", db: "postgres://user:pass@localhost:5432/test" });

    const signaled = process.emit("SIGTERM");
    expect(signaled).toBe(true);

    await exitCalled;

    expect(stateStoreStart).toHaveBeenCalledTimes(1);
    expect(stateStoreStop).toHaveBeenCalledTimes(1);
    expect(watcherStop).toHaveBeenCalledTimes(1);
    expect(artifactStop).toHaveBeenCalledTimes(1);
    expect(outboxStop).toHaveBeenCalledTimes(1);
    expect(workSignalStop).toHaveBeenCalledTimes(1);
  }, 15_000);
});
