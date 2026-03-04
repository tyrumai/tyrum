import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mitt from "mitt";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { listWatcherEpisodes } from "../helpers/memory-v1-helpers.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WatcherProcessor", () => {
  let db: SqliteDb;
  let memoryV1Dal: MemoryV1Dal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;

  beforeEach(() => {
    db = openTestSqliteDb();
    memoryV1Dal = new MemoryV1Dal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryV1Dal, eventBus });
  });

  afterEach(async () => {
    await db.close();
  });

  function findEpisodeByType(episodes: any[], eventType: string): any | undefined {
    return episodes.find((item) => (item?.provenance?.metadata as any)?.event_type === eventType);
  }

  it("creates episodic events for matching plan completion", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

    const episodes = await listWatcherEpisodes(memoryV1Dal);
    expect(findEpisodeByType(episodes, "plan_completed")).toBeTruthy();
  });

  it("treats plan completion episode recording as best-effort", async () => {
    const id = await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createSpy = vi
      .spyOn(memoryV1Dal, "create")
      .mockRejectedValue(new Error("episode recording failure"));

    await processor.onPlanCompleted({ planId: "plan-1", stepsExecuted: 5 });

    expect(warnSpy).toHaveBeenCalledWith(
      "watcher.plan_completed_episode_record_failed",
      expect.objectContaining({
        watcher_id: id,
        plan_id: "plan-1",
        error: "episode recording failure",
      }),
    );

    createSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs plan failure and deactivates plan_complete watchers", async () => {
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    const episodes = await listWatcherEpisodes(memoryV1Dal);
    expect(findEpisodeByType(episodes, "plan_failed")).toBeTruthy();
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("treats plan failure episode recording as best-effort and still deactivates plan_complete watchers", async () => {
    const id = await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createSpy = vi
      .spyOn(memoryV1Dal, "create")
      .mockRejectedValue(new Error("episode recording failure"));

    await processor.onPlanFailed({ planId: "plan-1", reason: "timeout" });

    expect(await processor.listWatchers()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "watcher.plan_failed_episode_record_failed",
      expect.objectContaining({
        watcher_id: id,
        plan_id: "plan-1",
        error: "episode recording failure",
      }),
    );

    createSpy.mockRestore();
    warnSpy.mockRestore();
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
    const episodes = await listWatcherEpisodes(memoryV1Dal);
    expect(findEpisodeByType(episodes, "plan_completed")).toBeTruthy();

    processor.stop();
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

  it("records webhook triggers and rejects replayed nonce+timestamp envelopes", async () => {
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

    const episodes = await listWatcherEpisodes(memoryV1Dal);
    expect(
      episodes.filter((e) => (e?.provenance?.metadata as any)?.event_type === "webhook_fired"),
    ).toHaveLength(1);
  });

  it("treats webhook episode recording as best-effort", async () => {
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

    const fired = vi.fn();
    eventBus.on("watcher:fired", fired);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createSpy = vi
      .spyOn(memoryV1Dal, "create")
      .mockRejectedValue(new Error("episode recording failure"));

    const recorded = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: 1_700_000_000_000,
      nonce: "nonce-best-effort",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(recorded).toBe(true);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "watcher.webhook_episode_record_failed",
      expect.objectContaining({
        watcher_id: id,
        plan_id: "plan-1",
        error: "episode recording failure",
      }),
    );

    const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM watcher_firings");
    expect(count?.n).toBe(1);

    createSpy.mockRestore();
    warnSpy.mockRestore();
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

    const episodes = await listWatcherEpisodes(memoryV1Dal);
    const fired = findEpisodeByType(episodes, "webhook_fired");
    expect(fired).toBeDefined();
    const payload = fired!.provenance.metadata as Record<string, unknown> | undefined;
    expect(payload?.["firing_id"]).toBe(firings[0]!.watcher_firing_id);
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
      memoryV1Dal,
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
