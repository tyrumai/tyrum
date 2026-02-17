import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import mitt from "mitt";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { createWatcherRoutes } from "../../src/routes/watcher.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

function setupDb(): Database.Database {
  const db = createDatabase(":memory:");
  migrate(db, migrationsDir);
  return db;
}

describe("Watcher routes + scheduler integration", () => {
  let db: Database.Database;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;
  let app: Hono;

  beforeEach(() => {
    db = setupDb();
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
    app = new Hono();
    app.route("/", createWatcherRoutes(processor));
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
    processor.createWatcher("plan-1", "periodic", { intervalMs: 30000 });
    processor.createWatcher("plan-2", "plan_complete", { planId: "plan-2" });

    const res = await app.request("/watchers", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      watchers: Array<{ plan_id: string }>;
    };
    expect(body.watchers).toHaveLength(2);
  });

  it("PATCH /watchers/:id deactivates a watcher", async () => {
    const id = processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(200);
    expect(processor.listWatchers()).toHaveLength(0);
  });

  it("DELETE /watchers/:id deactivates a watcher", async () => {
    const id = processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(processor.listWatchers()).toHaveLength(0);
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
    scheduler.tick();

    // Verify episodic event was created
    const events = memoryDal.getEpisodicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("periodic_fired");
  });
});
