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

  // --- Lifecycle ---

  describe("start / stop", () => {
    it("subscribes to events on start", () => {
      processor.start();

      // Emit an event and verify the processor handled it by checking
      // that no episodic events exist yet (no matching watchers).
      eventBus.emit("plan:completed", {
        planId: "plan-1",
        stepsExecuted: 3,
      });

      // No watchers configured, so no episodic events should be created
      const events = memoryDal.getEpisodicEvents("any-subject");
      expect(events).toHaveLength(0);

      processor.stop();
    });

    it("unsubscribes from events on stop", () => {
      processor.start();

      // Create a watcher so we can verify events stop being processed
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      processor.stop();

      // Emit after stop -- should NOT create an episodic event
      eventBus.emit("plan:completed", {
        planId: "plan-1",
        stepsExecuted: 2,
      });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(0);
    });
  });

  // --- onPlanCompleted ---

  describe("onPlanCompleted", () => {
    it("creates episodic event for matching watchers", () => {
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe("plan_completed");
      expect(events[0]!.channel).toBe("watcher");

      const payload = events[0]!.payload as {
        planId: string;
        stepsExecuted: number;
      };
      expect(payload.planId).toBe("plan-1");
      expect(payload.stepsExecuted).toBe(5);
    });

    it("does not fire for non-matching plan ids", () => {
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      processor.onPlanCompleted({ planId: "plan-other", stepsExecuted: 1 });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(0);
    });

    it("does not fire for inactive watchers", () => {
      const watcherId = processor.createWatcher(
        "subject-1",
        "plan-1",
        "plan_complete",
        { planId: "plan-1" },
      );
      processor.deactivateWatcher(watcherId);

      processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 2 });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(0);
    });

    it("does not fire for periodic trigger type", () => {
      processor.createWatcher("subject-1", "plan-1", "periodic", {
        intervalMs: 60_000,
      });

      processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 1 });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(0);
    });

    it("fires via event bus when started", () => {
      processor.start();

      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      eventBus.emit("plan:completed", { planId: "plan-1", stepsExecuted: 3 });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(1);

      processor.stop();
    });
  });

  // --- onPlanFailed ---

  describe("onPlanFailed", () => {
    it("logs failure as episodic event", () => {
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe("plan_failed");

      const payload = events[0]!.payload as {
        planId: string;
        reason: string;
      };
      expect(payload.planId).toBe("plan-1");
      expect(payload.reason).toBe("timeout");
    });

    it("deactivates one-shot (plan_complete) watchers on failure", () => {
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      processor.onPlanFailed({ planId: "plan-1", reason: "executor crashed" });

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(0);
    });

    it("does not deactivate periodic watchers on failure", () => {
      processor.createWatcher("subject-1", "plan-1", "periodic", {
        intervalMs: 60_000,
      });

      processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(1);
    });

    it("fires via event bus when started", () => {
      processor.start();

      processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      eventBus.emit("plan:failed", {
        planId: "plan-1",
        reason: "step failed",
      });

      const events = memoryDal.getEpisodicEvents("subject-1");
      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe("plan_failed");

      processor.stop();
    });
  });

  // --- CRUD ---

  describe("createWatcher", () => {
    it("inserts into DB and returns the id", () => {
      const id = processor.createWatcher("subject-1", "plan-1", "plan_complete", {
        planId: "plan-1",
      });

      expect(id).toBeGreaterThan(0);

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(1);
      expect(watchers[0]!.plan_id).toBe("plan-1");
      expect(watchers[0]!.trigger_type).toBe("plan_complete");
      expect(watchers[0]!.trigger_config).toEqual({ planId: "plan-1" });
    });

    it("stores trigger config as JSON", () => {
      const config = { planId: "plan-1", threshold: 42, tags: ["a", "b"] };
      processor.createWatcher("subject-1", "plan-1", "plan_complete", config);

      const watchers = processor.listWatchers("subject-1");
      expect(watchers[0]!.trigger_config).toEqual(config);
    });
  });

  describe("listWatchers", () => {
    it("returns active watchers for subject", () => {
      processor.createWatcher("subject-1", "plan-1", "plan_complete", {});
      processor.createWatcher("subject-1", "plan-2", "periodic", {});
      processor.createWatcher("subject-2", "plan-3", "plan_complete", {});

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(2);
    });

    it("returns empty array when no active watchers exist", () => {
      const watchers = processor.listWatchers("nonexistent");
      expect(watchers).toEqual([]);
    });

    it("excludes inactive watchers", () => {
      const id = processor.createWatcher(
        "subject-1",
        "plan-1",
        "plan_complete",
        {},
      );
      processor.deactivateWatcher(id);

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(0);
    });
  });

  describe("deactivateWatcher", () => {
    it("sets active=0", () => {
      const id = processor.createWatcher(
        "subject-1",
        "plan-1",
        "plan_complete",
        {},
      );

      processor.deactivateWatcher(id);

      const watchers = processor.listWatchers("subject-1");
      expect(watchers).toHaveLength(0);

      // Verify the row still exists in DB with active=0
      const row = db
        .prepare("SELECT active FROM watchers WHERE id = ?")
        .get(id) as { active: number } | undefined;
      expect(row).toBeDefined();
      expect(row!.active).toBe(0);
    });
  });
});
