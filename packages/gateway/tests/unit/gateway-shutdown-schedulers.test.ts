import { afterEach, describe, expect, it, vi } from "vitest";

describe("gateway shutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stops the StateStoreLifecycleScheduler on shutdown", async () => {
    vi.resetModules();

    vi.stubEnv("GATEWAY_DB_PATH", "postgres://user:pass@localhost:5432/test");
    vi.stubEnv("TYRUM_SECRET_PROVIDER", "env");

    const watcherStop = vi.fn();
    const artifactStop = vi.fn();
    const outboxStop = vi.fn();
    const stateStoreStart = vi.fn();
    const stateStoreStop = vi.fn();

    vi.doMock("../../src/container.js", () => {
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

      return {
        createContainerAsync: async () =>
          ({
            db,
            memoryDal: {},
            contextReportDal: {},
            secretResolutionAuditDal: {},
            eventLog: {},
            discoveryPipeline: {},
            riskClassifier: {},
            sessionDal: {},
            eventBus: {},
            approvalDal: { respond: async () => null },
            presenceDal: {},
            policySnapshotDal: {},
            policyOverrideDal: {},
            policyService: {},
            nodePairingDal: {},
            watcherProcessor: { start: vi.fn(), stop: vi.fn() },
            canvasDal: {},
            jobQueue: {},
            redactionEngine: undefined,
            artifactStore: {},
            modelsDev: { startBackgroundRefresh: vi.fn(), stopBackgroundRefresh: vi.fn() },
            oauthPendingDal: {},
            oauthRefreshLeaseDal: {},
            oauthProviderRegistry: {},
            logger,
            config: {
              dbPath: "postgres://user:pass@localhost:5432/test",
              migrationsDir: "/dev/null",
              tyrumHome: "/tmp",
            },
          }) as any,
        createContainer: vi.fn(),
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

    vi.doMock("../../src/modules/auth/token-store.js", () => {
      return {
        TokenStore: class {
          async initialize(): Promise<string> {
            return "token";
          }
        },
      };
    });

    vi.doMock("../../src/modules/hooks/config.js", () => {
      return {
        loadLifecycleHooksFromHome: async () => [],
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
    await main("scheduler");

    const signaled = process.emit("SIGTERM");
    expect(signaled).toBe(true);

    await exitCalled;

    expect(stateStoreStart).toHaveBeenCalledTimes(1);
    expect(stateStoreStop).toHaveBeenCalledTimes(1);
    expect(watcherStop).toHaveBeenCalledTimes(1);
    expect(artifactStop).toHaveBeenCalledTimes(1);
    expect(outboxStop).toHaveBeenCalledTimes(1);
  });
});
