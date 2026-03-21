import { expect, it, vi } from "vitest";
import type { GatewayEvents } from "../../src/event-bus.js";
import { ScheduleService } from "../../src/modules/automation/schedule-service.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { listWatcherEpisodes } from "../helpers/memory-helpers.js";
import {
  requireWatcherSchedulerContext,
  type WatcherSchedulerState,
} from "./watcher-scheduler.test-support.js";

async function countEpisodesByEventType(
  state: WatcherSchedulerState,
  eventType: string,
): Promise<number> {
  const { memoryDal } = requireWatcherSchedulerContext(state);
  const episodes = await listWatcherEpisodes(memoryDal);
  return episodes.filter(
    (episode) =>
      (episode?.provenance?.metadata as { event_type?: string } | undefined)?.event_type ===
      eventType,
  ).length;
}

export function registerWatcherSchedulerCoreTests(state: WatcherSchedulerState): void {
  it("fires periodic watcher on first tick", async () => {
    const { db, processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);

    const firings = await db.all<{ status: string }>("SELECT status FROM watcher_firings");
    expect(firings).toHaveLength(1);
    expect(firings[0]!.status).toBe("enqueued");
  });

  it("continues batch processing without creating periodic memory", async () => {
    const { db, eventBus, processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    await processor.createWatcher("plan-2", "periodic", { intervalMs: 1000 });

    const received: GatewayEvents["watcher:fired"][] = [];
    eventBus.on("watcher:fired", (event) => received.push(event));

    await scheduler.tick();

    expect(received).toHaveLength(2);
    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);

    const firings = await db.all<{ watcher_id: string; status: string }>(
      "SELECT watcher_id, status FROM watcher_firings ORDER BY watcher_id",
    );
    expect(firings).toHaveLength(2);
    expect(firings[0]!.status).toBe("enqueued");
    expect(firings[1]!.status).toBe("enqueued");
  });

  it("does not fire if interval has not elapsed", async () => {
    const { processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 60_000 });

    await scheduler.tick();
    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });

  it("does not fire a newly created interval schedule until the first full interval elapses", async () => {
    const { db, scheduler } = requireWatcherSchedulerContext(state);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:14:00.000Z"));

    const service = new ScheduleService(db, new IdentityScopeDal(db));
    await service.createSchedule({
      tenantId: DEFAULT_TENANT_ID,
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 5 * 60_000 },
      execution: {
        kind: "agent_turn",
        instruction: "Check workboard state.",
      },
      delivery: { mode: "quiet" },
    });

    await scheduler.tick();

    const firingsBeforeInterval = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watcher_firings",
    );
    expect(firingsBeforeInterval?.count).toBe(0);

    vi.setSystemTime(new Date("2026-03-06T10:15:00.000Z"));
    await scheduler.tick();

    const firingsAfterInterval = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watcher_firings",
    );
    expect(firingsAfterInterval?.count).toBe(1);
  });

  it("skips watchers with invalid config", async () => {
    const { db, processor, scheduler } = requireWatcherSchedulerContext(state);
    const id = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    await db.run(
      "UPDATE watchers SET trigger_config_json = ? WHERE tenant_id = ? AND watcher_id = ?",
      [JSON.stringify({ intervalMs: "invalid" }), DEFAULT_TENANT_ID, id],
    );

    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });

  it("skips watchers with non-positive intervalMs", async () => {
    const { processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 0 });
    await processor.createWatcher("plan-2", "periodic", { intervalMs: -1 });

    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });

  it("ignores non-periodic watchers", async () => {
    const { processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "plan_complete", { planId: "plan-1" });

    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });

  it("emits watcher:fired event on fire", async () => {
    const { eventBus, processor, scheduler } = requireWatcherSchedulerContext(state);
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    const received: GatewayEvents["watcher:fired"][] = [];
    eventBus.on("watcher:fired", (event) => received.push(event));

    await scheduler.tick();

    expect(received).toHaveLength(1);
    expect(received[0]!.planId).toBe("plan-1");
    expect(received[0]!.triggerType).toBe("periodic");
  });

  it("start and stop manage the interval timer", () => {
    const { scheduler } = requireWatcherSchedulerContext(state);

    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
  });

  it("unrefs the interval timer by default (does not keep the process alive)", () => {
    const { scheduler } = requireWatcherSchedulerContext(state);
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
    const { db, eventBus, memoryDal } = requireWatcherSchedulerContext(state);
    const scheduler = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      tickMs: 100,
      keepProcessAlive: true,
    });

    scheduler.start();
    try {
      const timer = (scheduler as unknown as { timer?: NodeJS.Timeout }).timer;
      expect(timer).toBeDefined();
      expect(timer!.hasRef()).toBe(true);
    } finally {
      scheduler.stop();
    }
  });

  it("does not fire inactive periodic watchers", async () => {
    const { processor, scheduler } = requireWatcherSchedulerContext(state);
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 1000,
    });
    await processor.deactivateWatcher(id);

    await scheduler.tick();

    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });

  it("claims webhook firings without emitting periodic events", async () => {
    const { db, processor, scheduler } = requireWatcherSchedulerContext(state);
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
      timestampMs: Date.now(),
      nonce: "nonce-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(recorded).toBe(true);

    await scheduler.tick();

    const firings = await db.all<{ status: string; trigger_type: string }>(
      `SELECT f.status AS status, w.trigger_type AS trigger_type
       FROM watcher_firings f
       JOIN watchers w
         ON w.tenant_id = f.tenant_id AND w.watcher_id = f.watcher_id`,
    );
    expect(firings).toHaveLength(1);
    expect(firings[0]!.trigger_type).toBe("webhook");
    expect(firings[0]!.status).toBe("enqueued");
    expect(await countEpisodesByEventType(state, "webhook_fired")).toBe(0);
    expect(await countEpisodesByEventType(state, "periodic_fired")).toBe(0);
  });
}
