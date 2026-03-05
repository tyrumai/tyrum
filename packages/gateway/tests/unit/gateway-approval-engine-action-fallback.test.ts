import { afterEach, describe, expect, it, vi } from "vitest";

describe("gateway approval engine action fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("passes policyService to the worker approval-engine fallback", async () => {
    vi.stubEnv("GATEWAY_DB_PATH", "postgres://user:pass@localhost:5432/test");

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
    const executionEngineOptions: unknown[] = [];

    vi.doMock("../../src/container.js", () => ({
      createContainer: vi.fn(),
      createContainerAsync: async () =>
        ({
          db,
          logger,
          modelsDev: { startBackgroundRefresh: vi.fn(), stopBackgroundRefresh: vi.fn() },
          policyService,
          policySnapshotDal: {},
          approvalDal: { resolveWithEngineAction: vi.fn() },
          presenceDal: {},
          policyOverrideDal: {},
          nodePairingDal: {},
          contextReportDal: {},
          memoryV1Dal: {},
          eventBus: {},
          watcherProcessor: { start: vi.fn(), stop: vi.fn() },
          artifactStore: {},
          redactionEngine,
          telegramBot: undefined,
          sessionDal: {},
          eventLog: {},
          config: {
            dbPath: "postgres://user:pass@localhost:5432/test",
            migrationsDir: "/dev/null",
            tyrumHome: "/tmp",
          },
        }) as any,
    }));

    vi.doMock("../../src/modules/auth/token-store.js", () => ({
      TokenStore: class TokenStore {
        async initialize(): Promise<string> {
          return "x".repeat(32);
        }
      },
    }));

    vi.doMock("../../src/modules/secret/create-secret-provider.js", () => ({
      createDbSecretProvider: async () => ({ secretProvider: true }),
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

    vi.doMock("../../src/modules/execution/engine.js", () => ({
      ExecutionEngine: class ExecutionEngine {
        constructor(opts: unknown) {
          executionEngineOptions.push(opts);
        }

        async resumeRun(): Promise<string | undefined> {
          return undefined;
        }

        async cancelRun(): Promise<"cancelled"> {
          return "cancelled";
        }
      },
    }));

    vi.doMock("../../src/modules/approval/engine-action-processor.js", () => ({
      ApprovalEngineActionProcessor: class ApprovalEngineActionProcessor {
        start(): void {}
        stop(): void {}
      },
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

    vi.doMock("../../src/modules/agent/node-dispatch-service.js", () => ({
      NodeDispatchService: class NodeDispatchService {},
    }));

    const { main } = await import("../../src/index.js");
    await main("worker");

    const approvalFallback = executionEngineOptions.find(
      (opts) =>
        typeof opts === "object" &&
        opts !== null &&
        !("secretProvider" in opts) &&
        "redactionEngine" in opts,
    );

    expect(approvalFallback).toMatchObject({
      db,
      redactionEngine,
      policyService,
    });
  }, 15_000);
});
