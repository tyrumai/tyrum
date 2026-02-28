import { afterEach, describe, expect, it, vi } from "vitest";
import { startExecutionWorkerLoop } from "../../src/modules/execution/worker-loop.js";

afterEach(() => {
  vi.useRealTimers();
});

async function waitForCalls(mockFn: { mock: { calls: unknown[] } }, count: number): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (mockFn.mock.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${count} call(s)`);
}

describe("Execution worker loop", () => {
  it("logs started/stopped and resolves done after stop", async () => {
    vi.useFakeTimers();

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    const engine = {
      workerTick: vi.fn(async () => false),
    };

    const executor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const loop = startExecutionWorkerLoop({
      engine: engine as any,
      workerId: "w-1",
      executor: executor as any,
      logger: logger as any,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    expect(logger.info).toHaveBeenCalledWith(
      "worker.loop.started",
      expect.objectContaining({ worker_id: "w-1" }),
    );

    try {
      await waitForCalls(engine.workerTick, 1);
      expect(engine.workerTick).toHaveBeenCalledWith(
        expect.objectContaining({ workerId: "w-1", executor }),
      );
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }

    expect(logger.info).toHaveBeenCalledWith(
      "worker.loop.stopped",
      expect.objectContaining({ worker_id: "w-1" }),
    );
  });

  it("sleeps idleSleepMs between ticks when no work is done", async () => {
    vi.useFakeTimers();

    const engine = {
      workerTick: vi.fn(async () => false),
    };

    const executor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const loop = startExecutionWorkerLoop({
      engine: engine as any,
      workerId: "w-idle",
      executor: executor as any,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    try {
      await waitForCalls(engine.workerTick, 1);

      await vi.advanceTimersByTimeAsync(9);
      expect(engine.workerTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await waitForCalls(engine.workerTick, 2);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("yields with a 0ms sleep after doing work", async () => {
    vi.useFakeTimers();

    let calls = 0;
    const engine = {
      workerTick: vi.fn(async () => {
        calls += 1;
        return calls === 1;
      }),
    };

    const executor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const loop = startExecutionWorkerLoop({
      engine: engine as any,
      workerId: "w-yield",
      executor: executor as any,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 5,
    });

    try {
      await waitForCalls(engine.workerTick, 2);

      await vi.advanceTimersByTimeAsync(0);
      await waitForCalls(engine.workerTick, 3);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("recovers from workerTick errors and continues after errorSleepMs", async () => {
    vi.useFakeTimers();

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    let calls = 0;
    const engine = {
      workerTick: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        return false;
      }),
    };

    const executor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const loop = startExecutionWorkerLoop({
      engine: engine as any,
      workerId: "w-error",
      executor: executor as any,
      logger: logger as any,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 1,
    });

    try {
      await waitForCalls(engine.workerTick, 1);
      expect(logger.error).toHaveBeenCalledWith(
        "worker.loop.error",
        expect.objectContaining({ error: "db down" }),
      );

      await vi.advanceTimersByTimeAsync(10);
      await waitForCalls(engine.workerTick, 2);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });

  it("does not exceed maxTicksPerCycle per loop cycle", async () => {
    vi.useFakeTimers();

    const engine = {
      workerTick: vi.fn(async () => true),
    };

    const executor = {
      execute: vi.fn(async () => ({ success: true })),
    };

    const loop = startExecutionWorkerLoop({
      engine: engine as any,
      workerId: "w-max",
      executor: executor as any,
      idleSleepMs: 10,
      errorSleepMs: 10,
      maxTicksPerCycle: 3,
    });

    try {
      await waitForCalls(engine.workerTick, 3);
      await Promise.resolve();
      expect(engine.workerTick).toHaveBeenCalledTimes(3);
    } finally {
      loop.stop();
      await vi.advanceTimersByTimeAsync(10);
      await loop.done;
    }
  });
});
