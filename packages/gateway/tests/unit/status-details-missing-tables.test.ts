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
});

