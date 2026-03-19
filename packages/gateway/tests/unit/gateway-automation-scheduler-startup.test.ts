import { DeploymentConfig } from "@tyrum/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("gateway automation scheduler startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("seeds default heartbeat schedules before starting the scheduler and wires automation deps", async () => {
    vi.resetModules();

    const order: string[] = [];
    const executionEngineOptions: unknown[] = [];
    const watcherSchedulerOptions: unknown[] = [];
    const scheduleServiceCalls: string[] = [];
    const ExecutionEngine = vi.fn(function ExecutionEngine(opts: unknown) {
      executionEngineOptions.push(opts);
    });
    const ScheduleService = vi.fn(function ScheduleService() {});
    ScheduleService.prototype.seedDefaultHeartbeatSchedules = async function seed() {
      scheduleServiceCalls.push("seed");
      order.push("seed");
      return 2;
    };
    function PlaybookRunner() {}
    const WatcherScheduler = vi.fn(function WatcherScheduler(opts: unknown) {
      watcherSchedulerOptions.push(opts);
    });
    WatcherScheduler.prototype.start = function start() {
      order.push("start");
    };
    WatcherScheduler.prototype.stop = function stop() {};
    function ArtifactLifecycleScheduler() {}
    ArtifactLifecycleScheduler.prototype.start = function start() {};
    ArtifactLifecycleScheduler.prototype.stop = function stop() {};
    function OutboxLifecycleScheduler() {}
    OutboxLifecycleScheduler.prototype.start = function start() {};
    OutboxLifecycleScheduler.prototype.stop = function stop() {};
    function StateStoreLifecycleScheduler() {}
    StateStoreLifecycleScheduler.prototype.start = function start() {};
    StateStoreLifecycleScheduler.prototype.stop = function stop() {};

    vi.doMock("../../src/modules/execution/engine.js", () => ({
      ExecutionEngine,
    }));

    vi.doMock("../../src/modules/automation/schedule-service.js", () => ({
      ScheduleService,
    }));

    vi.doMock("../../src/modules/playbook/loader.js", () => ({
      loadAllPlaybooks: vi.fn(() => []),
    }));

    vi.doMock("../../src/modules/playbook/runner.js", () => ({
      PlaybookRunner,
    }));

    vi.doMock("../../src/modules/watcher/scheduler.js", () => ({
      WatcherScheduler,
    }));

    vi.doMock("../../src/modules/artifact/lifecycle.js", () => ({
      ArtifactLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/backplane/outbox-lifecycle.js", () => ({
      OutboxLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/statestore/lifecycle.js", () => ({
      StateStoreLifecycleScheduler,
    }));

    const { startBackgroundSchedulers } =
      await import("../../src/bootstrap/runtime-builders-background.js");

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const db = { kind: "sqlite" };
    const identityScopeDal = {};
    const eventBus = {};
    const memoryDal = {};
    const policyService = { loadEffectiveBundle: vi.fn(), getOrCreateSnapshot: vi.fn() };
    const redactionEngine = { redact: vi.fn() };
    const secretProviderForTenant = vi.fn();
    const watcherProcessor = { start: vi.fn() };

    const background = await startBackgroundSchedulers({
      role: "scheduler",
      deploymentConfig: DeploymentConfig.parse({ automation: { enabled: true } }),
      container: {
        db,
        identityScopeDal,
        memoryDal,
        eventBus,
        policyService,
        redactionEngine,
        watcherProcessor,
        artifactStore: {},
        policySnapshotDal: {},
        logger,
        config: { tyrumHome: "/tmp/tyrum-test" },
      },
      logger,
      secretProviderForTenant,
      shouldRunEdge: false,
    } as any);

    expect(scheduleServiceCalls).toEqual(["seed"]);
    expect(order).toEqual(["seed", "start"]);
    expect(executionEngineOptions).toHaveLength(1);
    expect(executionEngineOptions[0]).toMatchObject({
      db,
      redactionEngine,
      secretProviderForTenant,
      policyService,
      logger,
    });
    expect(watcherSchedulerOptions).toHaveLength(1);
    expect(watcherSchedulerOptions[0]).toMatchObject({
      db,
      memoryDal,
      eventBus,
      logger,
      engine: expect.any(Object),
      policyService,
      automationEnabled: true,
      keepProcessAlive: true,
    });
    expect(logger.info).toHaveBeenCalledWith("automation.default_heartbeat_seeded", { count: 2 });
    expect(background.watcherScheduler).toBeDefined();
    expect(watcherProcessor.start).not.toHaveBeenCalled();
  });

  it("skips heartbeat seeding and scheduler engine wiring when automation is disabled", async () => {
    vi.resetModules();

    const executionEngineOptions: unknown[] = [];
    const watcherSchedulerOptions: unknown[] = [];
    const seedSpy = vi.fn();
    const ExecutionEngine = vi.fn(function ExecutionEngine(opts: unknown) {
      executionEngineOptions.push(opts);
    });
    const ScheduleService = vi.fn(function ScheduleService() {});
    ScheduleService.prototype.seedDefaultHeartbeatSchedules = async function seed() {
      seedSpy();
      return 0;
    };
    function PlaybookRunner() {}
    const WatcherScheduler = vi.fn(function WatcherScheduler(opts: unknown) {
      watcherSchedulerOptions.push(opts);
    });
    WatcherScheduler.prototype.start = function start() {};
    WatcherScheduler.prototype.stop = function stop() {};
    function ArtifactLifecycleScheduler() {}
    ArtifactLifecycleScheduler.prototype.start = function start() {};
    ArtifactLifecycleScheduler.prototype.stop = function stop() {};
    function OutboxLifecycleScheduler() {}
    OutboxLifecycleScheduler.prototype.start = function start() {};
    OutboxLifecycleScheduler.prototype.stop = function stop() {};
    function StateStoreLifecycleScheduler() {}
    StateStoreLifecycleScheduler.prototype.start = function start() {};
    StateStoreLifecycleScheduler.prototype.stop = function stop() {};

    vi.doMock("../../src/modules/execution/engine.js", () => ({
      ExecutionEngine,
    }));

    vi.doMock("../../src/modules/automation/schedule-service.js", () => ({
      ScheduleService,
    }));

    vi.doMock("../../src/modules/playbook/loader.js", () => ({
      loadAllPlaybooks: vi.fn(() => []),
    }));

    vi.doMock("../../src/modules/playbook/runner.js", () => ({
      PlaybookRunner,
    }));

    vi.doMock("../../src/modules/watcher/scheduler.js", () => ({
      WatcherScheduler,
    }));

    vi.doMock("../../src/modules/artifact/lifecycle.js", () => ({
      ArtifactLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/backplane/outbox-lifecycle.js", () => ({
      OutboxLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/statestore/lifecycle.js", () => ({
      StateStoreLifecycleScheduler,
    }));

    const { startBackgroundSchedulers } =
      await import("../../src/bootstrap/runtime-builders-background.js");

    await startBackgroundSchedulers({
      role: "scheduler",
      deploymentConfig: DeploymentConfig.parse({ automation: { enabled: false } }),
      container: {
        db: { kind: "sqlite" },
        identityScopeDal: {},
        memoryDal: {},
        eventBus: {},
        policyService: {},
        redactionEngine: {},
        watcherProcessor: { start: vi.fn() },
        artifactStore: {},
        policySnapshotDal: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        config: { tyrumHome: "/tmp/tyrum-test" },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      secretProviderForTenant: vi.fn(),
      shouldRunEdge: false,
    } as any);

    expect(seedSpy).not.toHaveBeenCalled();
    expect(executionEngineOptions).toHaveLength(0);
    expect(watcherSchedulerOptions).toHaveLength(1);
    expect(watcherSchedulerOptions[0]).toMatchObject({
      automationEnabled: false,
      engine: undefined,
    });
  });

  it("does not load playbooks for non-scheduler roles", async () => {
    vi.resetModules();

    const loadAllPlaybooks = vi.fn(() => []);
    const PlaybookRunner = vi.fn(function PlaybookRunner() {});
    const WatcherScheduler = vi.fn(function WatcherScheduler() {});
    WatcherScheduler.prototype.start = function start() {};
    WatcherScheduler.prototype.stop = function stop() {};
    function ArtifactLifecycleScheduler() {}
    ArtifactLifecycleScheduler.prototype.start = function start() {};
    ArtifactLifecycleScheduler.prototype.stop = function stop() {};
    function OutboxLifecycleScheduler() {}
    OutboxLifecycleScheduler.prototype.start = function start() {};
    OutboxLifecycleScheduler.prototype.stop = function stop() {};
    function StateStoreLifecycleScheduler() {}
    StateStoreLifecycleScheduler.prototype.start = function start() {};
    StateStoreLifecycleScheduler.prototype.stop = function stop() {};

    vi.doMock("../../src/modules/playbook/loader.js", () => ({
      loadAllPlaybooks,
    }));

    vi.doMock("../../src/modules/playbook/runner.js", () => ({
      PlaybookRunner,
    }));

    vi.doMock("../../src/modules/watcher/scheduler.js", () => ({
      WatcherScheduler,
    }));

    vi.doMock("../../src/modules/artifact/lifecycle.js", () => ({
      ArtifactLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/backplane/outbox-lifecycle.js", () => ({
      OutboxLifecycleScheduler,
    }));

    vi.doMock("../../src/modules/statestore/lifecycle.js", () => ({
      StateStoreLifecycleScheduler,
    }));

    const { startBackgroundSchedulers } =
      await import("../../src/bootstrap/runtime-builders-background.js");

    await startBackgroundSchedulers({
      role: "worker",
      deploymentConfig: DeploymentConfig.parse({ automation: { enabled: true } }),
      container: {
        db: { kind: "sqlite" },
        identityScopeDal: {},
        memoryDal: {},
        eventBus: {},
        policyService: {},
        redactionEngine: {},
        watcherProcessor: { start: vi.fn() },
        artifactStore: {},
        policySnapshotDal: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        config: { tyrumHome: "/tmp/tyrum-test" },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      secretProviderForTenant: vi.fn(),
      shouldRunEdge: false,
    } as any);

    expect(loadAllPlaybooks).not.toHaveBeenCalled();
    expect(PlaybookRunner).not.toHaveBeenCalled();
    expect(WatcherScheduler).not.toHaveBeenCalled();
  });
});
