import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mitt from "mitt";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { PolicyBundle } from "@tyrum/schemas";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import type { PolicyService } from "../../src/modules/policy/service.js";

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

    const firings = await db.all<{ status: string }>(
      "SELECT status FROM watcher_firings",
    );
    expect(firings).toHaveLength(1);
    expect(firings[0]!.status).toBe("enqueued");
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

  it("claims webhook firings without emitting periodic events", async () => {
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

    const recorded = await processor.recordWebhookTrigger(watcher!, {
      timestampMs: Date.now(),
      nonce: "nonce-1",
      bodySha256: "abc123",
      bodyBytes: 11,
    });
    expect(recorded).toBe(true);

    await scheduler.tick();

    const firings = await db.all<{ status: string; trigger_type: string }>(
      "SELECT status, trigger_type FROM watcher_firings",
    );
    expect(firings).toHaveLength(1);
    expect(firings[0]!.trigger_type).toBe("webhook");
    expect(firings[0]!.status).toBe("enqueued");

    const events = await memoryDal.getEpisodicEvents();
    expect(events.filter((event) => event.event_type === "webhook_fired")).toHaveLength(1);
    expect(events.filter((event) => event.event_type === "periodic_fired")).toHaveLength(0);
  });

  it("includes firing + lease ids in the cron execution trigger metadata", async () => {
    const prev = process.env["TYRUM_AUTOMATION_ENABLED"];
    process.env["TYRUM_AUTOMATION_ENABLED"] = "1";

    const enqueuedInputs: Array<Record<string, unknown>> = [];
    const policyBundle = PolicyBundle.parse({ v: 1 });
    const schedulerWithEngine = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      owner: "scheduler-1",
      firingLeaseTtlMs: 10_000,
      engine: {
        enqueuePlanInTx: async (_tx, input) => {
          enqueuedInputs.push(input as unknown as Record<string, unknown>);
          return { jobId: "job-1", runId: "run-1" };
        },
      } as unknown as ExecutionEngine,
      policyService: {
        loadEffectiveBundle: async () => ({
          bundle: policyBundle,
          sha256: "sha256",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
        getOrCreateSnapshot: async () => ({
          policy_snapshot_id: "snapshot-1",
          sha256: "sha256",
          created_at: new Date().toISOString(),
          bundle: policyBundle,
        }),
      } as unknown as PolicyService,
    });

    try {
      await processor.createWatcher("plan-1", "periodic", {
        intervalMs: 1000,
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      });

      await schedulerWithEngine.tick();

      expect(enqueuedInputs).toHaveLength(1);

      const firing = await db.get<{ firing_id: string }>("SELECT firing_id FROM watcher_firings");
      expect(firing).toBeDefined();
      expect(firing!.firing_id).toBeTypeOf("string");

      const trigger = enqueuedInputs[0]?.["trigger"] as Record<string, unknown> | undefined;
      expect(trigger).toBeDefined();
      expect(trigger?.["kind"]).toBe("cron");

      const metadata = trigger?.["metadata"] as Record<string, unknown> | undefined;
      expect(metadata?.["firing_id"]).toBe(firing!.firing_id);
      expect(metadata?.["lease_owner"]).toBe("scheduler-1");
      expect(typeof metadata?.["lease_expires_at_ms"]).toBe("number");
    } finally {
      if (prev === undefined) {
        delete process.env["TYRUM_AUTOMATION_ENABLED"];
      } else {
        process.env["TYRUM_AUTOMATION_ENABLED"] = prev;
      }
    }
  });

  it("uses heartbeat trigger kind when lane is heartbeat", async () => {
    const prev = process.env["TYRUM_AUTOMATION_ENABLED"];
    process.env["TYRUM_AUTOMATION_ENABLED"] = "1";

    const enqueuedInputs: Array<Record<string, unknown>> = [];
    const policyBundle = PolicyBundle.parse({ v: 1 });
    const schedulerWithEngine = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      owner: "scheduler-1",
      firingLeaseTtlMs: 10_000,
      engine: {
        enqueuePlanInTx: async (_tx, input) => {
          enqueuedInputs.push(input as unknown as Record<string, unknown>);
          return { jobId: "job-1", runId: "run-1" };
        },
      } as unknown as ExecutionEngine,
      policyService: {
        loadEffectiveBundle: async () => ({
          bundle: policyBundle,
          sha256: "sha256",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
        getOrCreateSnapshot: async () => ({
          policy_snapshot_id: "snapshot-1",
          sha256: "sha256",
          created_at: new Date().toISOString(),
          bundle: policyBundle,
        }),
      } as unknown as PolicyService,
    });

    try {
      await processor.createWatcher("plan-1", "periodic", {
        intervalMs: 1000,
        key: "agent:default:main",
        lane: "heartbeat",
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      });

      await schedulerWithEngine.tick();

      expect(enqueuedInputs).toHaveLength(1);
      const trigger = enqueuedInputs[0]?.["trigger"] as Record<string, unknown> | undefined;
      expect(trigger).toBeDefined();
      expect(trigger?.["kind"]).toBe("heartbeat");
      expect(trigger?.["lane"]).toBe("heartbeat");
    } finally {
      if (prev === undefined) {
        delete process.env["TYRUM_AUTOMATION_ENABLED"];
      } else {
        process.env["TYRUM_AUTOMATION_ENABLED"] = prev;
      }
    }
  });
});
