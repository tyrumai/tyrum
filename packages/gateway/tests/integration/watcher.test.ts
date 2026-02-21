import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import mitt from "mitt";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { createWatcherRoutes } from "../../src/routes/watcher.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Watcher routes + scheduler integration", () => {
  let db: SqliteDb;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;
  let app: Hono;
  const agentId = "default";

  beforeEach(() => {
    db = openTestSqliteDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
    app = new Hono();
    app.route("/", createWatcherRoutes(processor));
  });

  afterEach(async () => {
    await db.close();
  });

  it("POST /watchers creates a watcher", async () => {
    const res = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: "plan-1",
        trigger_type: "periodic",
        trigger_config: { intervalMs: 30000 },
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; plan_id: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.plan_id).toBe("plan-1");
  });

  it("GET /watchers lists active watchers", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 30000 });
    await processor.createWatcher("plan-2", "plan_complete", { planId: "plan-2" });

    const res = await app.request("/watchers", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      watchers: Array<{ plan_id: string }>;
    };
    expect(body.watchers).toHaveLength(2);
  });

  it("PATCH /watchers/:id deactivates a watcher", async () => {
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(200);
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("DELETE /watchers/:id deactivates a watcher", async () => {
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("POST /watchers returns 400 for missing fields", async () => {
    const res = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "plan-1" }),
    });

    expect(res.status).toBe(400);
  });

  it("create watcher via route, fire periodic trigger via scheduler", async () => {
    // Create a periodic watcher via the route
    const createRes = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: "plan-1",
        trigger_type: "periodic",
        trigger_config: { intervalMs: 1000 },
      }),
    });
    expect(createRes.status).toBe(201);

    // Fire a scheduler tick
    const scheduler = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      tickMs: 100,
    });
    await scheduler.tick();

    // Verify episodic event was created
    const events = await memoryDal.getEpisodicEvents(agentId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("periodic_fired");
  });
});
