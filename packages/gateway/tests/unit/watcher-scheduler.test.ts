import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mitt from "mitt";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WatcherScheduler", () => {
  let db: SqliteDb;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;
  let scheduler: WatcherScheduler;

  beforeEach(() => {
    db = openTestSqliteDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
    scheduler = new WatcherScheduler({ db, memoryDal, eventBus, tickMs: 100 });
  });

  afterEach(async () => {
    await db.close();
  });

  it("fires periodic watcher on first tick", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    await scheduler.tick();

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("periodic_fired");
  });

  it("does not fire if interval has not elapsed", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 60_000 });

    await scheduler.tick();
    await scheduler.tick(); // second tick, interval not yet elapsed

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1); // only fired once
  });

  it("skips watchers with invalid config", async () => {
    // Insert a periodic watcher with invalid trigger_config directly
    await db.run(
      "INSERT INTO watchers (plan_id, trigger_type, trigger_config) VALUES (?, ?, ?)",
      ["plan-1", "periodic", "not-json{"],
    );

    await scheduler.tick();

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("skips watchers with non-positive intervalMs", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 0 });
    await processor.createWatcher("plan-2", "periodic", { intervalMs: -1 });

    await scheduler.tick();

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("ignores non-periodic watchers", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await scheduler.tick();

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("emits watcher:fired event on fire", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    const received: GatewayEvents["watcher:fired"][] = [];
    eventBus.on("watcher:fired", (e) => received.push(e));

    await scheduler.tick();

    expect(received).toHaveLength(1);
    expect(received[0]!.planId).toBe("plan-1");
    expect(received[0]!.triggerType).toBe("periodic");
  });

  it("start and stop manage the interval timer", () => {
    scheduler.start();
    // Starting again is idempotent
    scheduler.start();
    scheduler.stop();
    // Stopping again is safe
    scheduler.stop();
  });

  it("unrefs the interval timer by default (does not keep the process alive)", () => {
    scheduler.start();
    try {
      const timer = (scheduler as unknown as { timer?: NodeJS.Timeout }).timer;
      expect(timer).toBeDefined();
      expect(timer!.hasRef()).toBe(false);
    } finally {
      scheduler.stop();
    }
  });

  it("keeps the interval timer refed when keepProcessAlive is true", () => {
    const keepAliveScheduler = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      tickMs: 100,
      keepProcessAlive: true,
    });

    keepAliveScheduler.start();
    try {
      const timer = (keepAliveScheduler as unknown as { timer?: NodeJS.Timeout }).timer;
      expect(timer).toBeDefined();
      expect(timer!.hasRef()).toBe(true);
    } finally {
      keepAliveScheduler.stop();
    }
  });

  it("does not fire inactive periodic watchers", async () => {
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 1000,
    });
    await processor.deactivateWatcher(id);

    await scheduler.tick();

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });
});
