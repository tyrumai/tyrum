import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDatabase } from "../../src/db.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { buildStatusDetails } from "../../src/modules/observability/status-details.js";
import { createStatusRoutes } from "../../src/routes/status.js";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000000";

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

    const details = await buildStatusDetails({ tenantId: TEST_TENANT_ID, db });
    expect(details.model_auth.auth_profiles).toBeNull();
    expect(details.session_lanes).toEqual([]);
    expect(details.queue_depth).toBeNull();
    expect(details.catalog_freshness.last_refresh_status).toBe("unavailable");
    expect(details.config_health).toEqual({ status: "ok", issues: [] });
  });

  it("GET /status returns ok when observability tables are missing", async () => {
    db = openBareSqliteDb();

    const routes = createStatusRoutes({
      version: "test-version",
      instanceId: "test-instance",
      role: "all",
      dbKind: db.kind,
      db,
      isLocalOnly: true,
      otelEnabled: false,
    });

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: TEST_TENANT_ID,
        role: "admin",
        scopes: [],
      });
      return await next();
    });
    app.route("/", routes);

    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["queue_depth"]).toBeNull();
    expect(body["config_health"]).toEqual({ status: "ok", issues: [] });
  });

  it("keeps queue depth when some queue tables are missing", async () => {
    db = openBareSqliteDb();

    await db.exec(
      `CREATE TABLE execution_runs (
         tenant_id TEXT NOT NULL,
         key TEXT NOT NULL,
         lane TEXT NOT NULL,
         run_id TEXT NOT NULL,
         status TEXT NOT NULL,
         created_at TEXT NOT NULL
       );`,
    );
    await db.exec(
      `INSERT INTO execution_runs (tenant_id, key, lane, run_id, status, created_at) VALUES
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-1', 'queued', '2026-02-23T00:00:00.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-2', 'queued', '2026-02-23T00:00:01.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-3', 'running', '2026-02-23T00:00:02.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-4', 'paused', '2026-02-23T00:00:03.000Z');`,
    );

    const details = await buildStatusDetails({ tenantId: TEST_TENANT_ID, db });

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

  it("keeps session lanes when lane_leases is missing", async () => {
    db = openBareSqliteDb();

    await db.exec(
      `CREATE TABLE execution_runs (
         tenant_id TEXT NOT NULL,
         key TEXT NOT NULL,
         lane TEXT NOT NULL,
         run_id TEXT NOT NULL,
         status TEXT NOT NULL,
         created_at TEXT NOT NULL
       );`,
    );
    await db.exec(
      `INSERT INTO execution_runs (tenant_id, key, lane, run_id, status, created_at) VALUES
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-1', 'queued', '2026-02-23T00:00:00.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-2', 'queued', '2026-02-23T00:00:01.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-3', 'running', '2026-02-23T00:00:02.000Z'),
         ('${TEST_TENANT_ID}', 'agent:default:ui:main', 'main', 'run-4', 'paused', '2026-02-23T00:00:03.000Z');`,
    );

    const details = await buildStatusDetails({ tenantId: TEST_TENANT_ID, db });

    expect(details.session_lanes).toHaveLength(1);
    expect(details.session_lanes[0]).toEqual({
      key: "agent:default:ui:main",
      lane: "main",
      latest_run_id: "run-4",
      latest_run_status: "paused",
      queued_runs: 2,
      lease_owner: null,
      lease_expires_at_ms: null,
      lease_active: false,
    });
  });

  it("keeps auth profile health when session_provider_pins is missing", async () => {
    db = openBareSqliteDb();

    await db.exec(
      `CREATE TABLE auth_profiles (
         tenant_id TEXT NOT NULL,
         auth_profile_id TEXT NOT NULL,
         provider_key TEXT NOT NULL,
         type TEXT NOT NULL,
         status TEXT NOT NULL,
         updated_at TEXT NOT NULL
       );`,
    );
    await db.exec(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         provider_key,
         type,
         status,
         updated_at
       ) VALUES
         ('${TEST_TENANT_ID}', 'profile-1', 'openai', 'api_key', 'active', '2026-02-23T00:00:01.000Z'),
         ('${TEST_TENANT_ID}', 'profile-2', 'openai', 'api_key', 'disabled', '2026-02-23T00:00:00.000Z');`,
    );

    const details = await buildStatusDetails({ tenantId: TEST_TENANT_ID, db });
    const auth = details.model_auth.auth_profiles as NonNullable<
      typeof details.model_auth.auth_profiles
    >;

    expect(auth.total).toBe(2);
    expect(auth.active).toBe(1);
    expect(auth.disabled).toBe(1);
    expect(auth.providers).toEqual(["openai"]);
    expect(auth.selected).toBeNull();
  });
});
