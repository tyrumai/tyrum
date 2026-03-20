import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepExecutor } from "../src/engine/types.js";
import type { ExecutionWorkerEngine, ExecutionWorkerLogger } from "../src/worker-loop.js";
import { startExecutionWorkerLoop } from "../src/worker-loop.js";

afterEach(() => {
  vi.useRealTimers();
});

async function waitForCalls(mockFn: { mock: { calls: unknown[] } }, count: number): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (mockFn.mock.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${count} call(s)`);
}

function createExecutor(): StepExecutor {
  return {
    execute: vi.fn(async () => ({ success: true })),
  };
}

function createLogger(): ExecutionWorkerLogger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("Execution worker loop", () => {
  it("logs started and stopped messages and resolves done after stop", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => false),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-1",
      executor,
      logger,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    expect(logger.info).toHaveBeenCalledWith(
      "worker.loop.started",
      expect.objectContaining({ worker_id: "worker-1" }),
    );

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 1);
      expect(engine.workerTick).toHaveBeenCalledWith({
        workerId: "worker-1",
        executor,
      });
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }

    expect(logger.info).toHaveBeenCalledWith(
      "worker.loop.stopped",
      expect.objectContaining({ worker_id: "worker-1" }),
    );
  });

  it("waits for the clamped idle sleep when no work is done", async () => {
    vi.useFakeTimers();

    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => false),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-idle",
      executor,
      idleSleepMs: 2,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 1);

      await vi.advanceTimersByTimeAsync(9);
      expect(engine.workerTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 2);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("yields with a 0ms sleep after a cycle that did work", async () => {
    vi.useFakeTimers();

    let calls = 0;
    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => {
        calls += 1;
        return calls === 1;
      }),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-yield",
      executor,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 5,
    });

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 2);

      await vi.advanceTimersByTimeAsync(0);
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 3);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("recovers from workerTick errors after the clamped error sleep", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    let calls = 0;
    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("db down") as Error & { run_id?: string };
          error.run_id = "run-1";
          throw error;
        }
        return false;
      }),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-error",
      executor,
      logger,
      idleSleepMs: 10,
      errorSleepMs: 4,
      maxTicksPerCycle: 1,
    });

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 1);
      expect(logger.error).toHaveBeenCalledWith(
        "worker.loop.error",
        expect.objectContaining({
          worker_id: "worker-error",
          run_id: "run-1",
          error: "db down",
        }),
      );

      await vi.advanceTimersByTimeAsync(9);
      expect(engine.workerTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 2);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("logs camelCase runId values and non-Error throws", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    let calls = 0;
    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw { runId: " run-2 ", message: "ignored object" };
        }
        if (calls === 2) {
          throw "plain failure";
        }
        return false;
      }),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-runid",
      executor,
      logger,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 1);
      expect(logger.error).toHaveBeenNthCalledWith(
        1,
        "worker.loop.error",
        expect.objectContaining({
          worker_id: "worker-runid",
          run_id: "run-2",
          error: "[object Object]",
        }),
      );

      await vi.advanceTimersByTimeAsync(10);
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 2);
      expect(logger.error).toHaveBeenNthCalledWith(
        2,
        "worker.loop.error",
        expect.objectContaining({
          worker_id: "worker-runid",
          run_id: undefined,
          error: "plain failure",
        }),
      );
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("does not exceed the clamped max ticks per cycle", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const engine: ExecutionWorkerEngine = {
      workerTick: vi.fn(async () => true),
    };
    const executor = createExecutor();

    const loop = startExecutionWorkerLoop({
      engine,
      workerId: "worker-max",
      executor,
      logger,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 0,
    });

    try {
      await waitForCalls(engine.workerTick as { mock: { calls: unknown[] } }, 1);
      await Promise.resolve();
      expect(engine.workerTick).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        "worker.loop.started",
        expect.objectContaining({
          idle_sleep_ms: 10,
          error_sleep_ms: 10,
          max_ticks_per_cycle: 1,
        }),
      );
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });
});
