import { describe, expect, it, vi } from "vitest";
import { IntervalScheduler, pruneInBatches } from "../../src/modules/lifecycle/scheduler.js";

describe("lifecycle scheduler utilities", () => {
  it("IntervalScheduler does not run tick concurrently", async () => {
    const gate = vi.fn<[], Promise<void>>().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 25)),
    );
    const scheduler = new IntervalScheduler({
      tickMs: 60_000,
      keepProcessAlive: true,
      onTickError: () => {},
      tick: gate,
    });

    await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it("pruneInBatches stops when changes fall below batch size", async () => {
    const calls: number[] = [];
    const total = await pruneInBatches(
      {
        batchSize: 10,
        maxBatchesPerTick: 5,
      },
      async () => {
        calls.push(1);
        return calls.length === 1 ? 10 : 3;
      },
    );

    expect(total).toBe(13);
    expect(calls.length).toBe(2);
  });

  it("pruneInBatches calls onBudgetExhausted when max batches are consumed", async () => {
    const onBudgetExhausted = vi.fn();
    const total = await pruneInBatches(
      {
        batchSize: 2,
        maxBatchesPerTick: 3,
        onBudgetExhausted,
      },
      async () => 2,
    );

    expect(total).toBe(6);
    expect(onBudgetExhausted).toHaveBeenCalledTimes(1);
  });
});

