import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/db.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { buildStatusDetails } from "../../src/modules/observability/status-details.js";
import { createStatusRoutes } from "../../src/routes/status.js";

function openBareSqliteDb(): SqlDb {
  const raw = createDatabase(":memory:");

  const db: SqlDb = {
    kind: "sqlite",
    get: async (sql, params = []) => raw.prepare(sql).get(...params) as never,
    all: async (sql, params = []) => raw.prepare(sql).all(...params) as never[],
    run: async (sql, params = []) => {
      const res = raw.prepare(sql).run(...params);
      return { changes: res.changes };
    },
    exec: async (sql) => {
      raw.exec(sql);
    },
    transaction: async (fn) => {
      return await fn(db);
    },
    close: async () => {
      raw.close();
    },
  };

  return db;
}

describe("status details missing tables", () => {
  let db: SqlDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not throw when observability tables are missing", async () => {
    db = openBareSqliteDb();

    const details = await buildStatusDetails({ db });
    expect(details.model_auth.auth_profiles).toBeNull();
    expect(details.session_lanes).toEqual([]);
    expect(details.queue_depth).toBeNull();
    expect(details.catalog_freshness.last_refresh_status).toBe("unavailable");
  });

  it("GET /status returns ok when observability tables are missing", async () => {
    db = openBareSqliteDb();

    const app = createStatusRoutes({
      version: "test-version",
      instanceId: "test-instance",
      role: "all",
      dbKind: db.kind,
      db,
      isLocalOnly: true,
      otelEnabled: false,
    });

    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["queue_depth"]).toBeNull();
  });

  it("keeps queue depth when some queue tables are missing", async () => {
    db = openBareSqliteDb();

    await db.exec(
      `CREATE TABLE execution_runs (
         key TEXT NOT NULL,
         lane TEXT NOT NULL,
         run_id TEXT NOT NULL,
         status TEXT NOT NULL,
         created_at TEXT NOT NULL
       );`,
    );
    await db.exec(
      `INSERT INTO execution_runs (key, lane, run_id, status, created_at) VALUES
         ('agent:default:ui:main', 'main', 'run-1', 'queued', '2026-02-23T00:00:00.000Z'),
         ('agent:default:ui:main', 'main', 'run-2', 'queued', '2026-02-23T00:00:01.000Z'),
         ('agent:default:ui:main', 'main', 'run-3', 'running', '2026-02-23T00:00:02.000Z'),
         ('agent:default:ui:main', 'main', 'run-4', 'paused', '2026-02-23T00:00:03.000Z');`,
    );

    const details = await buildStatusDetails({ db });

    expect(details.queue_depth).not.toBeNull();
    expect(details.queue_depth?.execution_runs.queued).toBe(2);
    expect(details.queue_depth?.execution_runs.running).toBe(1);
    expect(details.queue_depth?.execution_runs.paused).toBe(1);
    expect(details.queue_depth?.execution_jobs.queued).toBe(0);
    expect(details.queue_depth?.channel_inbox.queued).toBe(0);
    expect(details.queue_depth?.channel_outbox.queued).toBe(0);
    expect(details.queue_depth?.watcher_firings.queued).toBe(0);
    expect(details.queue_depth?.pending_total).toBe(2);
    expect(details.queue_depth?.inflight_total).toBe(2);
  });
});
