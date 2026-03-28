import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  schedulerRegistryRef,
  createGatewayManagedDesktopProvisioner,
  createGatewaySubagentRuntime,
  createGatewayWorkboardRepository,
} = vi.hoisted(() => {
  const schedulerRegistry: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    tick: ReturnType<typeof vi.fn>;
    opts?: { onTickError?: (error: unknown) => void };
  }> = [];
  return {
    schedulerRegistryRef: schedulerRegistry,
    createGatewayManagedDesktopProvisioner: vi.fn(() => ({ kind: "desktop-provisioner" })),
    createGatewaySubagentRuntime: vi.fn(() => ({ kind: "subagent-runtime" })),
    createGatewayWorkboardRepository: vi.fn(() => ({ kind: "repository" })),
  };
});

type RuntimeDispatcherWrapper = {
  dispatcher: {
    opts: {
      repository: unknown;
      runtime: unknown;
      desktopProvisioner?: unknown;
    };
  };
};

type RuntimeReconcilerWrapper = {
  reconciler: {
    opts: {
      repository: unknown;
    };
  };
};

type RuntimeOrchestratorWrapper = {
  orchestrator: {
    opts: {
      repository: unknown;
      runtime: unknown;
    };
  };
};

describe("gateway workboard runtime wrappers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../src/modules/lifecycle/scheduler.js", () => ({
      IntervalScheduler: class IntervalSchedulerMock {
        start = vi.fn();
        stop = vi.fn();
        tick = vi.fn(async () => undefined);
        opts?: { onTickError?: (error: unknown) => void };

        constructor(opts?: { onTickError?: (error: unknown) => void }) {
          this.opts = opts;
          schedulerRegistryRef.push(this);
        }
      },
      resolvePositiveInt: vi.fn((value: number | undefined, fallback: number) => value ?? fallback),
    }));
    vi.doMock("../../src/modules/workboard/runtime-workboard-adapters.js", () => ({
      createGatewayManagedDesktopProvisioner,
      createGatewaySubagentRuntime,
      createGatewayWorkboardRepository,
    }));
    schedulerRegistryRef.length = 0;
    createGatewayManagedDesktopProvisioner.mockReset();
    createGatewaySubagentRuntime.mockReset();
    createGatewayWorkboardRepository.mockReset();

    createGatewayManagedDesktopProvisioner.mockImplementation(() => ({
      kind: "desktop-provisioner",
    }));
    createGatewaySubagentRuntime.mockImplementation(() => ({ kind: "subagent-runtime" }));
    createGatewayWorkboardRepository.mockImplementation(() => ({ kind: "repository" }));
  });

  it("wires the dispatcher wrapper through the shared scheduler and adapters", async () => {
    const { WorkboardDispatcher } = await import("../../src/modules/workboard/dispatcher.js");
    const logger = { error: vi.fn() } as never;
    const dispatcher = new WorkboardDispatcher({
      db: { kind: "sqlite" } as never,
      agents: { getRuntime: vi.fn() } as never,
      defaultDeploymentConfig: { server: { publicBaseUrl: "http://localhost:8788" } } as never,
      logger,
    });

    dispatcher.start();
    await dispatcher.tick();
    dispatcher.stop();
    schedulerRegistryRef.at(-1)?.opts?.onTickError?.(new Error("dispatcher boom"));

    expect((dispatcher as RuntimeDispatcherWrapper).dispatcher.opts).toMatchObject({
      repository: { kind: "repository" },
      runtime: { kind: "subagent-runtime" },
      desktopProvisioner: { kind: "desktop-provisioner" },
    });
    expect(createGatewayManagedDesktopProvisioner).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.start).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.tick).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.stop).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("workboard.dispatcher_tick_failed", {
      error: "dispatcher boom",
    });
  });

  it("wires the reconciler wrapper through the shared scheduler and repository", async () => {
    const { WorkboardReconciler } = await import("../../src/modules/workboard/reconciler.js");
    const logger = { error: vi.fn() } as never;
    const reconciler = new WorkboardReconciler({
      db: { kind: "sqlite" } as never,
      logger,
    });

    reconciler.start();
    await reconciler.tick();
    reconciler.stop();
    schedulerRegistryRef.at(-1)?.opts?.onTickError?.(new Error("reconciler boom"));

    expect((reconciler as RuntimeReconcilerWrapper).reconciler.opts).toMatchObject({
      repository: { kind: "repository" },
    });
    expect(schedulerRegistryRef.at(-1)?.start).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.tick).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.stop).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("workboard.reconciler_tick_failed", {
      error: "reconciler boom",
    });
  });

  it("wires the orchestrator wrapper through the shared scheduler and adapters", async () => {
    const { WorkboardOrchestrator } = await import("../../src/modules/workboard/orchestrator.js");
    const logger = { error: vi.fn() } as never;
    const orchestrator = new WorkboardOrchestrator({
      db: { kind: "sqlite" } as never,
      agents: { getRuntime: vi.fn() } as never,
      logger,
    });

    orchestrator.start();
    await orchestrator.tick();
    orchestrator.stop();
    schedulerRegistryRef.at(-1)?.opts?.onTickError?.(new Error("orchestrator boom"));

    expect((orchestrator as RuntimeOrchestratorWrapper).orchestrator.opts).toMatchObject({
      repository: { kind: "repository" },
      runtime: { kind: "subagent-runtime" },
    });
    expect(createGatewaySubagentRuntime).toHaveBeenCalled();
    expect(schedulerRegistryRef.at(-1)?.start).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.tick).toHaveBeenCalledTimes(1);
    expect(schedulerRegistryRef.at(-1)?.stop).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("workboard.orchestrator_tick_failed", {
      error: "orchestrator boom",
    });
  });
});
