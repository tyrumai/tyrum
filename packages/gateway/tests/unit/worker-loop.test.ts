import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startExecutionWorkerLoop } from "../../src/modules/execution/worker-loop.js";

function createMockEngine() {
  return {
    workerTick: vi.fn<[{ workerId: string; executor: unknown }], Promise<boolean>>().mockResolvedValue(false),
  };
}

function createMockExecutor() {
  return {};
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

describe("startExecutionWorkerLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops cleanly", async () => {
    const engine = createMockEngine();
    const logger = createMockLogger();

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-1",
      executor: createMockExecutor() as never,
      logger: logger as never,
      idleSleepMs: 10,
    });

    // Let the loop run at least one cycle
    await vi.advanceTimersByTimeAsync(15);

    loop.stop();
    await vi.advanceTimersByTimeAsync(15);
    await loop.done;

    expect(logger.info).toHaveBeenCalledWith("worker.loop.started", expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith("worker.loop.stopped", expect.any(Object));
  });

  it("calls engine.workerTick on each cycle", async () => {
    const engine = createMockEngine();

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-2",
      executor: createMockExecutor() as never,
      idleSleepMs: 10,
    });

    // Let several idle cycles pass
    await vi.advanceTimersByTimeAsync(35);

    loop.stop();
    await vi.advanceTimersByTimeAsync(15);
    await loop.done;

    expect(engine.workerTick.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(engine.workerTick).toHaveBeenCalledWith({
      workerId: "w-2",
      executor: expect.any(Object),
    });
  });

  it("stops when stop() is called", async () => {
    const engine = createMockEngine();

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-3",
      executor: createMockExecutor() as never,
      idleSleepMs: 10,
    });

    await vi.advanceTimersByTimeAsync(15);
    loop.stop();
    await vi.advanceTimersByTimeAsync(15);
    await loop.done;

    const callCount = engine.workerTick.mock.calls.length;

    // No more calls after done resolves
    await vi.advanceTimersByTimeAsync(50);
    expect(engine.workerTick.mock.calls.length).toBe(callCount);
  });

  it("sleeps idleSleepMs when no work available", async () => {
    const engine = createMockEngine();
    // Always returns false (no work)
    engine.workerTick.mockResolvedValue(false);

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-4",
      executor: createMockExecutor() as never,
      idleSleepMs: 50,
    });

    // After 10ms, only the first tick has run (sleeping 50ms idle)
    await vi.advanceTimersByTimeAsync(10);
    const countEarly = engine.workerTick.mock.calls.length;
    expect(countEarly).toBe(1);

    // Advance past the idle sleep
    await vi.advanceTimersByTimeAsync(50);
    expect(engine.workerTick.mock.calls.length).toBeGreaterThan(countEarly);

    loop.stop();
    await vi.advanceTimersByTimeAsync(60);
    await loop.done;
  });

  it("handles errors with errorSleepMs backoff", async () => {
    const engine = createMockEngine();
    const logger = createMockLogger();
    engine.workerTick.mockRejectedValue(new Error("engine failure"));

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-5",
      executor: createMockExecutor() as never,
      logger: logger as never,
      idleSleepMs: 10,
      errorSleepMs: 100,
    });

    // First tick errors, then sleeps 100ms
    await vi.advanceTimersByTimeAsync(10);
    expect(engine.workerTick).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("worker.loop.error", { error: "engine failure" });

    // Should not have ticked again before errorSleepMs
    await vi.advanceTimersByTimeAsync(50);
    expect(engine.workerTick).toHaveBeenCalledTimes(1);

    // After errorSleepMs, a second tick occurs
    await vi.advanceTimersByTimeAsync(60);
    expect(engine.workerTick.mock.calls.length).toBeGreaterThanOrEqual(2);

    loop.stop();
    await vi.advanceTimersByTimeAsync(110);
    await loop.done;
  });

  it("respects maxTicksPerCycle limit", async () => {
    const engine = createMockEngine();
    // workerTick always returns true (work always available).
    // Without the limit the loop would call it indefinitely.
    engine.workerTick.mockResolvedValue(true);

    const loop = startExecutionWorkerLoop({
      engine: engine as never,
      workerId: "w-6",
      executor: createMockExecutor() as never,
      idleSleepMs: 500,
      maxTicksPerCycle: 3,
    });

    // Let the first cycle complete (3 ticks + yield via sleep(0)),
    // and the second cycle (3 more ticks + yield), but NOT reach the
    // third cycle because we stop before the next sleep(0) resolves.
    await vi.advanceTimersByTimeAsync(1);
    loop.stop();
    await vi.advanceTimersByTimeAsync(1);
    await loop.done;

    // With maxTicksPerCycle=3, each cycle does at most 3 workerTick calls.
    // The total must be a multiple of 3 (every cycle completes all 3).
    const totalCalls = engine.workerTick.mock.calls.length;
    expect(totalCalls % 3).toBe(0);
    expect(totalCalls).toBeGreaterThanOrEqual(3);
  });
});
