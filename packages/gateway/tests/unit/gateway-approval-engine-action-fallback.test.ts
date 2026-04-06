import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";

describe("gateway approval engine action fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("passes policyService to the worker approval-engine fallback", async () => {
    vi.resetModules();

    const logger = {
      child: () => logger,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const db = {
      kind: "postgres" as const,
      get: async () => undefined,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => undefined,
      transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => await fn(db),
      close: vi.fn(async () => {}),
    };

    const policyService = { isEnabled: vi.fn(() => false) };
    const redactionEngine = { redact: vi.fn((value: string) => value) };
    const turnControllerOptions: unknown[] = [];
    const approvalProcessorOptions: unknown[] = [];
    let approvalProcessorStarts = 0;

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

        async issueToken(): Promise<{ token: string }> {
          return { token: "test-token" };
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

    vi.doMock("../../src/modules/hooks/config.js", () => ({
      loadLifecycleHooksFromHome: async () => [],
    }));

    vi.doMock("../../src/modules/observability/otel.js", () => ({
      maybeStartOtel: async () => ({
        enabled: false,
        shutdown: async () => {},
      }),
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
          approvalDal: { resolveWithEngineAction: vi.fn() },
          presenceDal: {},
          policySnapshotDal: {},
          policyOverrideDal: {},
          policyService,
          nodePairingDal: {},
          watcherProcessor: { start: vi.fn(), stop: vi.fn() },
          canvasDal: {},
          redactionEngine,
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

    vi.doMock("../../src/modules/agent/runtime/turn-controller.js", () => ({
      createTurnController: (opts: unknown) => {
        turnControllerOptions.push(opts);
        return {
          resumeTurn: async () => undefined,
          cancelTurn: async () => "cancelled" as const,
        };
      },
      NativeTurnController: function NativeTurnController(opts: unknown) {
        turnControllerOptions.push(opts);
      },
    }));

    function ApprovalEngineActionProcessorMock(this: object, opts: unknown) {
      approvalProcessorOptions.push(opts);
    }
    ApprovalEngineActionProcessorMock.prototype.start = function start(): void {
      approvalProcessorStarts += 1;
    };
    ApprovalEngineActionProcessorMock.prototype.stop = function stop(): void {};

    vi.doMock("../../src/modules/approval/engine-action-processor.js", () => ({
      ApprovalEngineActionProcessor: ApprovalEngineActionProcessorMock,
    }));

    vi.doMock("../../src/modules/execution/worker-loop.js", () => ({
      startExecutionWorkerLoop: vi.fn(() => ({
        stop: vi.fn(),
      })),
    }));

    vi.doMock("../../src/modules/execution/toolrunner-step-executor.js", () => ({
      createToolRunnerStepExecutor: vi.fn(() => ({ kind: "toolrunner" })),
    }));

    vi.doMock("../../src/modules/execution/kubernetes-toolrunner-step-executor.js", () => ({
      createKubernetesToolRunnerStepExecutor: vi.fn(() => ({ kind: "kubernetes-toolrunner" })),
    }));

    vi.doMock("../../src/modules/execution/gateway-step-executor.js", () => ({
      createGatewayStepExecutor: vi.fn(() => ({ kind: "gateway-step-executor" })),
    }));

    vi.doMock("../../src/modules/execution/node-dispatch-step-executor.js", () => ({
      createNodeDispatchStepExecutor: vi.fn(() => ({ kind: "node-dispatch-step-executor" })),
    }));

    vi.doMock("@tyrum/runtime-node-control", () => ({
      NodeDispatchService: function NodeDispatchService() {},
    }));

    const { main } = await import("../../src/index.js");
    await main({ role: "worker", db: "postgres://user:pass@localhost:5432/test" });

    const approvalFallback = turnControllerOptions[0];

    expect(approvalFallback).toMatchObject({
      db,
      redactText: expect.any(Function),
    });
    expect(approvalProcessorStarts).toBe(1);
    expect(approvalProcessorOptions).toHaveLength(1);
    expect(approvalProcessorOptions[0]).toMatchObject({
      db,
      logger,
      owner: expect.any(String),
      turnController: expect.any(Object),
      workflowRunner: expect.any(Object),
    });
  }, 15_000);
});
