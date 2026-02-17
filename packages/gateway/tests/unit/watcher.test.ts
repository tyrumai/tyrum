import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mitt from "mitt";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

function setupDb(): Database.Database {
  const db = createDatabase(":memory:");
  migrate(db, migrationsDir);
  return db;
}

describe("WatcherProcessor", () => {
  let db: Database.Database;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;

  beforeEach(() => {
    db = setupDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
  });

  it("creates episodic events for matching plan completion", () => {
    processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("plan_completed");
  });

  it("logs plan failure and deactivates plan_complete watchers", () => {
    processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("plan_failed");
    expect(processor.listWatchers()).toHaveLength(0);
  });

  it("keeps periodic watchers active after failure", () => {
    processor.createWatcher("plan-1", "periodic", { intervalMs: 60_000 });

    processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    expect(processor.listWatchers()).toHaveLength(1);
  });

  it("supports listing and deactivating watchers", () => {
    const id = processor.createWatcher("plan-1", "plan_complete", {});
    processor.createWatcher("plan-2", "periodic", {});

    expect(processor.listWatchers()).toHaveLength(2);

    processor.deactivateWatcher(id);
    expect(processor.listWatchers()).toHaveLength(1);
  });

  it("processes event bus events while started", () => {
    processor.start();
    processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    eventBus.emit("plan:completed", { planId: "plan-1", stepsExecuted: 3 });
    expect(memoryDal.getEpisodicEvents()).toHaveLength(1);

    processor.stop();
  });
});
