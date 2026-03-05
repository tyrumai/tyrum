import { describe, expect, it, vi } from "vitest";
import { createAutoSyncManager } from "../src/auto-sync.js";

describe("auto-sync", () => {
  it("runs enabled tasks on handleConnected and schedules next attempt", async () => {
    let nowMs = 1_000;
    let runs = 0;

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => true,
      nowMs: () => nowMs,
      random: () => 0.5, // no jitter
      tasks: [
        {
          id: "t1",
          run: async () => {
            runs += 1;
          },
        },
      ],
    });

    await manager.handleConnected();

    expect(runs).toBe(1);

    const task = manager.store.getSnapshot().tasks["t1"];
    expect(task?.consecutiveFailures).toBe(0);
    expect(task?.inFlight).toBe(false);
    expect(task?.nextAttemptAtMs).toBe(nowMs + 30_000);

    manager.dispose();
  });

  it("records success time and schedules next attempt from completion", async () => {
    let nowMs = 1_000;

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => true,
      nowMs: () => nowMs,
      random: () => 0.5, // no jitter
      tasks: [
        {
          id: "t1",
          run: async () => {
            nowMs = 6_000; // simulate slow task
          },
        },
      ],
    });

    await manager.handleConnected();

    const task = manager.store.getSnapshot().tasks["t1"];
    expect(task?.lastSuccessAt).toBe(6_000);
    expect(task?.nextAttemptAtMs).toBe(36_000);

    manager.dispose();
  });

  it("schedules backoff from failure time", async () => {
    let nowMs = 0;

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => true,
      nowMs: () => nowMs,
      random: () => 0.5, // no jitter
      tasks: [
        {
          id: "t1",
          run: async () => {
            nowMs = 5_000; // simulate slow task
            throw new Error("nope");
          },
        },
      ],
    });

    await manager.handleConnected();

    const task = manager.store.getSnapshot().tasks["t1"];
    expect(task?.consecutiveFailures).toBe(1);
    expect(task?.nextAttemptAtMs).toBe(35_000);

    manager.dispose();
  });

  it("applies exponential backoff with a 30s base and 5m cap", async () => {
    let nowMs = 0;
    const run = vi.fn(async () => {
      throw new Error("nope");
    });

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => true,
      nowMs: () => nowMs,
      random: () => 0.5, // no jitter
      tasks: [{ id: "t1", run }],
    });

    await manager.handleConnected();
    expect(run).toHaveBeenCalledTimes(1);
    expect(manager.store.getSnapshot().tasks["t1"]?.consecutiveFailures).toBe(1);
    expect(manager.store.getSnapshot().tasks["t1"]?.nextAttemptAtMs).toBe(30_000);

    nowMs = 30_000;
    await manager.tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(manager.store.getSnapshot().tasks["t1"]?.consecutiveFailures).toBe(2);
    expect(manager.store.getSnapshot().tasks["t1"]?.nextAttemptAtMs).toBe(90_000);

    nowMs = 90_000;
    await manager.tick();
    expect(run).toHaveBeenCalledTimes(3);
    expect(manager.store.getSnapshot().tasks["t1"]?.consecutiveFailures).toBe(3);
    expect(manager.store.getSnapshot().tasks["t1"]?.nextAttemptAtMs).toBe(210_000);

    nowMs = 210_000;
    await manager.tick();
    expect(run).toHaveBeenCalledTimes(4);

    // Fast-forward to a high failure count to assert cap (5 minutes)
    nowMs = 1_000_000;
    for (let i = 0; i < 10; i++) {
      await manager.syncAllNow();
    }
    const nextAttempt = manager.store.getSnapshot().tasks["t1"]?.nextAttemptAtMs;
    expect(nextAttempt).toBe(nowMs + 300_000);

    manager.dispose();
  });

  it("syncAllNow bypasses backoff but does nothing while disconnected", async () => {
    let nowMs = 0;
    const run = vi.fn(async () => {});

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => false,
      nowMs: () => nowMs,
      random: () => 0.5,
      tasks: [{ id: "t1", run }],
    });

    await manager.syncAllNow();
    await manager.tick();
    expect(run).toHaveBeenCalledTimes(0);

    manager.dispose();
  });

  it("does not double-run inFlight tasks", async () => {
    let resolve: (() => void) | null = null;
    const blocker = new Promise<void>((res) => {
      resolve = res;
    });

    const run = vi.fn(async () => {
      await blocker;
    });

    const manager = createAutoSyncManager({
      intervalMs: 30_000,
      isConnected: () => true,
      nowMs: () => 0,
      random: () => 0.5,
      tasks: [{ id: "t1", run }],
    });

    const p1 = manager.syncAllNow();
    const p2 = manager.syncAllNow();

    expect(run).toHaveBeenCalledTimes(1);

    resolve?.();
    await Promise.all([p1, p2]);

    manager.dispose();
  });
});
