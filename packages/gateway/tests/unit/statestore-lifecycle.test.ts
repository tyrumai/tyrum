import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import { StateStoreLifecycleScheduler } from "../../src/modules/statestore/lifecycle.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  createRecordingDb,
  createUnstableSessionTieBreakDb,
} from "./statestore-lifecycle.db-test-support.js";
import {
  createLifecycleTestClock,
  seedChannelRetentionFixture,
  seedFractionalSessionTtlFixture,
  seedOperationalPruneFixture,
  seedSessionPruneFixture,
  seedSessionTieFixture,
} from "./statestore-lifecycle.test-support.js";

describe("StateStoreLifecycleScheduler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("prunes expired sessions and TTL-derived tables", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();

    await seedSessionPruneFixture(db, now);

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: now.clock,
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    const sessions = await db.all<{ session_id: string }>(
      "SELECT conversation_id AS session_id FROM conversations WHERE tenant_id = ? ORDER BY conversation_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(sessions).toEqual([{ session_id: "session-fresh" }]);

    const pins = await db.all<{ session_id: string }>(
      "SELECT conversation_id AS session_id FROM conversation_provider_pins WHERE tenant_id = ? ORDER BY conversation_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(pins).toEqual([]);

    const reports = await db.all<{ context_report_id: string }>(
      "SELECT context_report_id FROM context_reports WHERE tenant_id = ? ORDER BY context_report_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(reports).toEqual([]);

    const overrides = await db.all<{ session_id: string; model_id: string }>(
      "SELECT conversation_id AS session_id, model_id FROM conversation_model_overrides WHERE tenant_id = ? ORDER BY conversation_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(overrides).toEqual([{ session_id: "session-fresh", model_id: "model-fresh" }]);

    const connections = await db.all<{ connection_id: string }>(
      "SELECT connection_id FROM connections WHERE tenant_id = ? ORDER BY connection_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(connections).toEqual([{ connection_id: "conn-fresh" }]);

    const dedupe = await db.all<{ message_id: string }>(
      "SELECT message_id FROM channel_inbound_dedupe WHERE tenant_id = ? ORDER BY message_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(dedupe).toEqual([{ message_id: "msg-fresh" }]);
  });

  it("prunes expired operational rows and records prune metrics", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();
    const metrics = new MetricsRegistry();
    const { extraWorkspaceId, freshAuthProfileId } = await seedOperationalPruneFixture(db, now);

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: now.clock,
      metrics,
      sessionsTtlDays: 30,
    });

    await scheduler.tick();

    const presence = await db.all<{ instance_id: string }>(
      "SELECT instance_id FROM presence_entries ORDER BY instance_id ASC",
    );
    expect(presence).toEqual([{ instance_id: "presence-fresh" }]);

    const laneLeases = await db.all<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_leases WHERE tenant_id = ? ORDER BY conversation_key ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(laneLeases).toEqual([{ key: "lane-new" }]);

    const workspaceLeases = await db.all<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspace_leases WHERE tenant_id = ? ORDER BY workspace_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(workspaceLeases).toEqual([{ workspace_id: extraWorkspaceId }]);

    const oauthPending = await db.all<{ state: string }>(
      "SELECT state FROM oauth_pending WHERE tenant_id = ? ORDER BY state ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(oauthPending).toEqual([{ state: "oauth-fresh" }]);

    const oauthRefreshLeases = await db.all<{ auth_profile_id: string }>(
      `SELECT auth_profile_id
       FROM oauth_refresh_leases
       WHERE tenant_id = ?
       ORDER BY auth_profile_id ASC`,
      [DEFAULT_TENANT_ID],
    );
    expect(oauthRefreshLeases).toEqual([{ auth_profile_id: freshAuthProfileId }]);

    const modelsRefreshLeases = await db.all<{ key: string }>(
      "SELECT key FROM models_dev_refresh_leases ORDER BY key ASC",
    );
    expect(modelsRefreshLeases).toEqual([{ key: "models-fresh" }]);

    const lifecycleMetrics = await metrics.registry.getSingleMetricAsString(
      "lifecycle_prune_rows_total",
    );
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="presence_entries"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="conversation_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="workspace_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="oauth_pending"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="oauth_refresh_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="models_dev_refresh_leases"');
  });

  it("keeps same instance_ids isolated when pruning expired presence rows", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();
    const tenantOneId = "00000000-0000-4000-8000-00000000b101";
    const tenantTwoId = "00000000-0000-4000-8000-00000000b102";

    await db.run(
      `INSERT INTO presence_entries (
         tenant_id,
         instance_id,
         role,
         connection_id,
         host,
         ip,
         version,
         mode,
         last_input_seconds,
         metadata_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms,
         updated_at
       )
       VALUES (?, ?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
      [
        tenantOneId,
        "shared-device",
        now.nowMs - 10_000,
        now.nowMs - 10_000,
        now.nowMs - 1,
        now.nowIso,
      ],
    );
    await db.run(
      `INSERT INTO presence_entries (
         tenant_id,
         instance_id,
         role,
         connection_id,
         host,
         ip,
         version,
         mode,
         last_input_seconds,
         metadata_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms,
         updated_at
       )
       VALUES (?, ?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
      [
        tenantTwoId,
        "shared-device",
        now.nowMs - 10_000,
        now.nowMs - 10_000,
        now.nowMs + 60_000,
        now.nowIso,
      ],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: now.clock,
      sessionsTtlDays: 30,
    });

    await scheduler.tick();

    const presence = await db.all<{ tenant_id: string; instance_id: string }>(
      "SELECT tenant_id, instance_id FROM presence_entries ORDER BY tenant_id ASC",
    );
    expect(presence).toEqual([
      {
        tenant_id: tenantTwoId,
        instance_id: "shared-device",
      },
    ]);
  });

  it("retains completed inbox rows until dependent terminal outbox rows are pruned", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();

    await seedChannelRetentionFixture(db, now);

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: now.clock,
      channelTerminalRetentionDays: 2,
      sessionsTtlDays: 30,
    });

    await scheduler.tick();

    const inboxAfterFirstTick = await db.all<{ inbox_id: number; status: string }>(
      "SELECT inbox_id, status FROM channel_inbox WHERE tenant_id = ? ORDER BY inbox_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(inboxAfterFirstTick).toEqual([{ inbox_id: 101, status: "completed" }]);

    const outboxAfterFirstTick = await db.all<{ outbox_id: number }>(
      "SELECT outbox_id FROM channel_outbox WHERE tenant_id = ? ORDER BY outbox_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(outboxAfterFirstTick).toEqual([]);

    await scheduler.tick();

    const inboxAfterSecondTick = await db.all<{ inbox_id: number }>(
      "SELECT inbox_id FROM channel_inbox WHERE tenant_id = ? ORDER BY inbox_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(inboxAfterSecondTick).toEqual([]);
  });

  it("does not orphan context reports when session pruning order has timestamp ties", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();

    await seedSessionTieFixture(db, now);

    const scheduler = new StateStoreLifecycleScheduler({
      db: createUnstableSessionTieBreakDb(db),
      clock: now.clock,
      batchSize: 1,
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    const orphaned = await db.all<{ context_report_id: string; session_id: string }>(
      `SELECT context_report_id, conversation_id AS session_id
       FROM context_reports
       WHERE (tenant_id, conversation_id) NOT IN (
         SELECT tenant_id, conversation_id FROM conversations
       )
       ORDER BY context_report_id ASC`,
    );
    expect(orphaned).toEqual([]);
  });

  it("avoids datetime(updated_at) in SQLite session pruning queries (index-friendly)", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();
    const runs: string[] = [];

    const scheduler = new StateStoreLifecycleScheduler({
      db: createRecordingDb(db, runs),
      clock: now.clock,
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    expect(runs.some((sql) => /datetime\s*\(\s*updated_at\s*\)/i.test(sql))).toBe(false);
    expect(runs.some((sql) => /WHERE\s+updated_at\s*<\s*\?/i.test(sql))).toBe(true);
  });

  it("does not floor fractional session TTL days to zero (data-loss guard)", async () => {
    db = openTestSqliteDb();
    const now = createLifecycleTestClock();

    await seedFractionalSessionTtlFixture(db, now);

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: now.clock,
      sessionsTtlDays: 0.5,
    });

    await scheduler.tick();

    const sessions = await db.all<{ session_id: string }>(
      "SELECT conversation_id AS session_id FROM conversations WHERE tenant_id = ? ORDER BY conversation_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(sessions).toEqual([{ session_id: "session-recent" }]);
  });
});
