import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mitt from "mitt";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { listWatcherEpisodes } from "../helpers/memory-helpers.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WatcherProcessor", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, eventBus });
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("does not create memory for matching plan completion", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

    const episodes = await listWatcherEpisodes(memoryDal);
    expect(episodes).toHaveLength(0);
  });

  it("deactivates plan_complete watchers without creating memory on plan failure", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    const episodes = await listWatcherEpisodes(memoryDal);
    expect(episodes).toHaveLength(0);
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

  it("does not subscribe plan completions while started", async () => {
    const onPlanCompletedSpy = vi.spyOn(processor, "onPlanCompleted");

    processor.start();
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    eventBus.emit("plan:completed", { planId: "plan-1", stepsExecuted: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const episodes = await listWatcherEpisodes(memoryDal);
    expect(episodes).toHaveLength(0);
    expect(onPlanCompletedSpy).not.toHaveBeenCalled();

    processor.stop();
    onPlanCompletedSpy.mockRestore();
  });

  it("logs and absorbs handler rejections while started", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const onPlanFailedSpy = vi.spyOn(processor, "onPlanFailed").mockReturnValue({
      catch: (handler: (err: unknown) => void) => {
        handler(new Error("boom"));
        return Promise.resolve();
      },
    } as unknown as Promise<void>);

    processor.start();
    eventBus.emit("plan:failed", { planId: "plan-1", reason: "timeout" });
    processor.stop();

    expect(warnSpy).toHaveBeenCalledWith(
      "watcher.plan_failed_handler_failed",
      expect.objectContaining({
        plan_id: "plan-1",
        error: "boom",
      }),
    );

    onPlanFailedSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("records webhook triggers without creating memory and rejects replayed nonce+timestamp envelopes", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "db",
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

    const episodes = await listWatcherEpisodes(memoryDal);
    expect(episodes).toHaveLength(0);
  });

  it("creates durable firing rows for webhook triggers", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "db",
        scope: "watcher:webhook:test",
        created_at: new Date().toISOString(),
      },
    });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();
    const timestampMs = 1_700_000_000_000;
    const nonce = "nonce-1";

    const first = await processor.recordWebhookTrigger(watcher!, {
      timestampMs,
      nonce,
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(first).toBe(true);

    const firings = await db.all<{
      watcher_firing_id: string;
      status: string;
      scheduled_at_ms: number;
    }>("SELECT watcher_firing_id, status, scheduled_at_ms FROM watcher_firings");
    expect(firings).toHaveLength(1);
    expect(firings[0]!.status).toBe("queued");
    expect(firings[0]!.scheduled_at_ms).toBe(timestampMs);

    const episodes = await listWatcherEpisodes(memoryDal);
    expect(episodes).toHaveLength(0);
  });

  it("rejects webhook nonce replays even when timestamp differs", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "db",
        scope: "watcher:webhook:test",
        created_at: new Date().toISOString(),
      },
    });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();

    const first = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: Date.now(),
      nonce: "nonce-3",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(first).toBe(true);

    const replay = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: Date.now() + 5,
      nonce: "nonce-3",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(replay).toBe(false);
  });

  it("persists multiple webhook firings even when timestamp matches", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "db",
        scope: "watcher:webhook:test",
        created_at: new Date().toISOString(),
      },
    });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();

    const timestampMs = 1_700_000_000_000;
    const first = await processor.recordWebhookTrigger(watcher!, {
      timestampMs,
      nonce: "nonce-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(first).toBe(true);

    const second = await processor.recordWebhookTrigger(watcher!, {
      timestampMs,
      nonce: "nonce-2",
      bodySha256: "def456",
      bodyBytes: 22,
    });
    expect(second).toBe(true);

    const firings = await db.all<{ watcher_firing_id: string }>(
      "SELECT watcher_firing_id FROM watcher_firings",
    );
    expect(firings).toHaveLength(2);
  });

  it("does not fail when many webhook firings share a coarse timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-24T00:00:00.000Z"));
    try {
      const id = await processor.createWatcher("plan-1", "webhook", {
        secret_handle: {
          handle_id: "secret-handle",
          provider: "db",
          scope: "watcher:webhook:test",
          created_at: new Date().toISOString(),
        },
      });
      const watcher = await processor.getActiveWatcherById(id);
      expect(watcher).not.toBeNull();

      const timestampMs = 1_700_000_000_000;
      const n = 1001;
      for (let i = 0; i < n; i += 1) {
        const recorded = await processor.recordWebhookTrigger(watcher!, {
          timestampMs,
          nonce: `nonce-${String(i)}`,
          bodySha256: `sha-${String(i)}`,
          bodyBytes: i,
        });
        expect(recorded).toBe(true);
        vi.advanceTimersByTime(1);
      }

      const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM watcher_firings");
      expect(count?.n).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears webhook scheduled_at cursor entries when watchers deactivate", async () => {
    const id = await processor.createWatcher("plan-1", "webhook", {
      secret_handle: {
        handle_id: "secret-handle",
        provider: "db",
        scope: "watcher:webhook:test",
        created_at: new Date().toISOString(),
      },
    });
    const watcher = await processor.getActiveWatcherById(id);
    expect(watcher).not.toBeNull();

    const recorded = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: 1_700_000_000_000,
      nonce: "nonce-cursor-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(recorded).toBe(true);

    const cursor = (processor as unknown as { webhookScheduledAtCursor: Map<string, unknown> })
      .webhookScheduledAtCursor;
    expect(cursor.has(id)).toBe(true);

    await processor.deactivateWatcher(id);
    expect(cursor.has(id)).toBe(false);
  });

  it("bounds webhook scheduled_at cursor map size", async () => {
    const limitedProcessor = new WatcherProcessor({
      db,
      eventBus,
      webhookScheduledAtCursorMaxEntries: 3,
    });

    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await limitedProcessor.createWatcher("plan-1", "webhook", {
        secret_handle: {
          handle_id: "secret-handle",
          provider: "db",
          scope: "watcher:webhook:test",
          created_at: new Date().toISOString(),
        },
      });
      ids.push(id);
      const watcher = await limitedProcessor.getActiveWatcherById(id);
      expect(watcher).not.toBeNull();

      const recorded = await limitedProcessor.recordWebhookTrigger(watcher!, {
        timestampMs: 1_700_000_000_000,
        nonce: `nonce-cursor-${String(i)}`,
        bodySha256: "abc123",
        bodyBytes: 11,
      });
      expect(recorded).toBe(true);
    }

    const cursor = (
      limitedProcessor as unknown as { webhookScheduledAtCursor: Map<string, unknown> }
    ).webhookScheduledAtCursor;
    expect(cursor.size).toBe(3);
    expect(cursor.has(ids[0]!)).toBe(false);
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
