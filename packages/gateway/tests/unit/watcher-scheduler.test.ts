import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mitt from "mitt";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

function setupDb(): Database.Database {
  const db = createDatabase(":memory:");
  migrate(db, migrationsDir);
  return db;
}

describe("WatcherScheduler", () => {
  let db: Database.Database;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;
  let scheduler: WatcherScheduler;

  beforeEach(() => {
    db = setupDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
    scheduler = new WatcherScheduler({ db, memoryDal, eventBus, tickMs: 100 });
  });

  it("fires periodic watcher on first tick", () => {
    processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    scheduler.tick();

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("periodic_fired");
  });

  it("does not fire if interval has not elapsed", () => {
    processor.createWatcher("plan-1", "periodic", { intervalMs: 60_000 });

    scheduler.tick();
    scheduler.tick(); // second tick, interval not yet elapsed

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1); // only fired once
  });

  it("skips watchers with invalid config", () => {
    // Insert a periodic watcher with invalid trigger_config directly
    db.prepare(
      `INSERT INTO watchers (plan_id, trigger_type, trigger_config) VALUES (?, ?, ?)`,
    ).run("plan-1", "periodic", "not-json{");

    scheduler.tick();

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("skips watchers with non-positive intervalMs", () => {
    processor.createWatcher("plan-1", "periodic", { intervalMs: 0 });
    processor.createWatcher("plan-2", "periodic", { intervalMs: -1 });

    scheduler.tick();

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("ignores non-periodic watchers", () => {
    processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    scheduler.tick();

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("emits watcher:fired event on fire", () => {
    processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    const received: GatewayEvents["watcher:fired"][] = [];
    eventBus.on("watcher:fired", (e) => received.push(e));

    scheduler.tick();

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

  it("does not fire inactive periodic watchers", () => {
    const id = processor.createWatcher("plan-1", "periodic", {
      intervalMs: 1000,
    });
    processor.deactivateWatcher(id);

    scheduler.tick();

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });
});
