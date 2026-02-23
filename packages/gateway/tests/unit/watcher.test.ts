import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mitt from "mitt";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WatcherProcessor", () => {
  let db: SqliteDb;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;

  beforeEach(() => {
    db = openTestSqliteDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates episodic events for matching plan completion", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("plan_completed");
  });

  it("logs plan failure and deactivates plan_complete watchers", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    const events = await memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("plan_failed");
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("keeps periodic watchers active after failure", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 60_000 });

    await processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    expect(await processor.listWatchers()).toHaveLength(1);
  });

  it("supports listing and deactivating watchers", async () => {
    const id = await processor.createWatcher("plan-1", "plan_complete", {});
    await processor.createWatcher("plan-2", "periodic", {});

    expect(await processor.listWatchers()).toHaveLength(2);

    await processor.deactivateWatcher(id);
    expect(await processor.listWatchers()).toHaveLength(1);
  });

  it("processes event bus events while started", async () => {
    processor.start();
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    eventBus.emit("plan:completed", { planId: "plan-1", stepsExecuted: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await memoryDal.getEpisodicEvents()).toHaveLength(1);

    processor.stop();
  });

  it("records webhook triggers and rejects replayed nonce+timestamp envelopes", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "file",
        scope: "watcher:webhook:test",
        created_at: new Date().toISOString(),
      },
    });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();
    const timestampMs = Date.now();

    const first = await processor.recordWebhookTrigger(watcher!, {
      timestampMs,
      nonce: "nonce-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(first).toBe(true);

    const replay = await processor.recordWebhookTrigger(watcher!, {
      timestampMs,
      nonce: "nonce-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(replay).toBe(false);

    const events = await memoryDal.getEpisodicEvents();
    expect(events.filter((event) => event.event_type === "webhook_fired")).toHaveLength(1);
  });

  it("does not record webhook trigger events for non-webhook watchers", async () => {
    const id = await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();

    const recorded = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: Date.now(),
      nonce: "nonce-2",
      bodySha256: "def456",
      bodyBytes: 22,
    });
    expect(recorded).toBe(false);
  });
});
