import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";

describe("gateway shutdown signal buffering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it(
    "replays a shutdown signal that arrives before the handler is ready",
    { timeout: 15_000 },
    async () => {
      vi.resetModules();

      const shutdown = vi.fn();
      const createShutdownHandler = vi.fn(() => shutdown);

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
        transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => await fn(db),
        close: vi.fn(async () => {}),
      };

      vi.doMock("../../src/statestore/postgres.js", () => ({
        PostgresDb: {
          open: vi.fn(async () => db),
        },
      }));

      vi.doMock("../../src/modules/config/deployment-config-dal.js", () => ({
        DeploymentConfigDal: class {
          async ensureSeeded(): Promise<{ config: unknown }> {
            return { config: DeploymentConfig.parse({}) };
          }
        },
      }));

      vi.doMock("../../src/modules/config/agent-config-dal.js", () => ({
        AgentConfigDal: class {
          async ensureSeeded(): Promise<{ config: unknown }> {
            return { config: {} };
          }
        },
      }));

      vi.doMock("../../src/modules/auth/auth-token-service.js", () => ({
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
      }));

      vi.doMock("../../src/modules/secret/create-secret-provider.js", () => ({
        createDbSecretProviderFactory: vi.fn(async () => ({
          keyId: "test",
          secretProviderForTenant: () => ({
            list: async () => [],
            resolve: async () => null,
            store: async () => {
              throw new Error("not implemented");
            },
            revoke: async () => false,
          }),
        })),
      }));

      vi.doMock("../../src/modules/observability/otel.js", () => ({
        maybeStartOtel: vi.fn(async () => ({ enabled: false, shutdown: async () => {} })),
      }));

      vi.doMock("../../src/container.js", () => ({
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
            conversationDal: {},
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
      }));

      vi.doMock("../../src/bootstrap/runtime-builders.js", () => ({
        startBackgroundSchedulers: vi.fn(async () => ({})),
        createProtocolRuntime: vi.fn(async () => {
          process.emit("SIGTERM");
          return {
            hooksRuntime: undefined,
            workSignalScheduler: undefined,
            approvalEngineActionProcessor: undefined,
          };
        }),
        startEdgeRuntime: vi.fn(async () => ({
          server: undefined,
          wsHandler: undefined,
          authRateLimiter: undefined,
          wsUpgradeRateLimiter: undefined,
          outboxPoller: undefined,
          telegramProcessor: undefined,
          pluginCatalogProvider: undefined,
          agents: undefined,
        })),
        createConversationLoop: vi.fn(() => undefined),
        createWorkerLoop: vi.fn(() => undefined),
        fireGatewayStartHook: vi.fn(),
        createShutdownHandler,
        runShutdownCleanup: vi.fn(),
      }));

      const { main } = await import("../../src/index.js");
      await main({ role: "scheduler", db: "postgres://user:pass@localhost:5432/test" });

      expect(createShutdownHandler).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledWith("SIGTERM");
    },
  );
});
