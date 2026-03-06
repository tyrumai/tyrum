import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { StateStoreLifecycleScheduler } from "../../src/modules/statestore/lifecycle.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("StateStoreLifecycleScheduler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("prunes expired sessions and TTL-derived tables", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();

    const expiredSessionUpdatedAt = "2026-02-22T23:59:59.000Z";
    const freshSessionUpdatedAt = "2026-02-23T00:00:01.000Z";

    const channelAccountId = randomUUID();
    await db.run(
      `INSERT INTO channel_accounts (tenant_id, workspace_id, channel_account_id, connector_key, account_key)
       VALUES (?, ?, ?, 'telegram', 'default')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId],
    );

    const threadExpired = randomUUID();
    const threadFresh = randomUUID();
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadExpired, channelAccountId, "thread-1"],
    );
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadFresh, channelAccountId, "thread-2"],
    );

    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-expired",
        "session-key-expired",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadExpired,
        now.toISOString(),
        expiredSessionUpdatedAt,
      ],
    );
    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-fresh",
        "session-key-fresh",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadFresh,
        now.toISOString(),
        freshSessionUpdatedAt,
      ],
    );

    await db.run(
      `INSERT INTO session_model_overrides (tenant_id, session_id, model_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, "session-expired", "model-expired"],
    );
    await db.run(
      `INSERT INTO session_model_overrides (tenant_id, session_id, model_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, "session-fresh", "model-fresh"],
    );

    const authProfileId = randomUUID();
    await db.run(
      `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
       VALUES (?, ?, 'profile-1', 'openai', 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, authProfileId],
    );
    await db.run(
      `INSERT INTO session_provider_pins (tenant_id, session_id, provider_key, auth_profile_id)
       VALUES (?, ?, 'openai', ?)`,
      [DEFAULT_TENANT_ID, "session-expired", authProfileId],
    );

    await db.run(
      `INSERT INTO context_reports (
         tenant_id,
         context_report_id,
         session_id,
         channel,
         thread_id,
         agent_id,
         workspace_id,
         report_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "cr-1",
        "session-expired",
        "telegram",
        "thread-1",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "{}",
        now.toISOString(),
      ],
    );

    await db.run(
      `INSERT INTO principals (tenant_id, principal_id, kind, principal_key, status)
       VALUES (?, ?, 'client', ?, 'active')`,
      [DEFAULT_TENANT_ID, "principal-expired", "client:principal-expired"],
    );
    await db.run(
      `INSERT INTO principals (tenant_id, principal_id, kind, principal_key, status)
       VALUES (?, ?, 'client', ?, 'active')`,
      [DEFAULT_TENANT_ID, "principal-fresh", "client:principal-fresh"],
    );

    await db.run(
      `INSERT INTO connections (tenant_id, connection_id, edge_id, principal_id, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, ?, 'edge-1', ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "conn-expired",
        "principal-expired",
        nowMs - 10_000,
        nowMs - 10_000,
        nowMs - 1,
      ],
    );
    await db.run(
      `INSERT INTO connections (tenant_id, connection_id, edge_id, principal_id, connected_at_ms, last_seen_at_ms, expires_at_ms)
       VALUES (?, ?, 'edge-1', ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "conn-fresh",
        "principal-fresh",
        nowMs - 10_000,
        nowMs - 10_000,
        nowMs + 60_000,
      ],
    );

    await db.run(
      `INSERT INTO channel_inbound_dedupe (tenant_id, channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
       VALUES (?, 'telegram', 'default', 'thread-1', ?, NULL, ?)`,
      [DEFAULT_TENANT_ID, "msg-expired", nowMs - 1],
    );
    await db.run(
      `INSERT INTO channel_inbound_dedupe (tenant_id, channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
       VALUES (?, 'telegram', 'default', 'thread-1', ?, NULL, ?)`,
      [DEFAULT_TENANT_ID, "msg-fresh", nowMs + 60_000],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    const sessions = await db.all<{ session_id: string }>(
      "SELECT session_id FROM sessions WHERE tenant_id = ? ORDER BY session_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(sessions).toEqual([{ session_id: "session-fresh" }]);

    const pins = await db.all<{ session_id: string }>(
      "SELECT session_id FROM session_provider_pins WHERE tenant_id = ? ORDER BY session_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(pins).toEqual([]);

    const reports = await db.all<{ context_report_id: string }>(
      "SELECT context_report_id FROM context_reports WHERE tenant_id = ? ORDER BY context_report_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(reports).toEqual([]);

    const overrides = await db.all<{ session_id: string; model_id: string }>(
      "SELECT session_id, model_id FROM session_model_overrides WHERE tenant_id = ? ORDER BY session_id ASC",
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

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();
    const metrics = new MetricsRegistry();

    await db.run(
      `INSERT INTO presence_entries (
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
       VALUES (?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
      ["presence-expired", nowMs - 10_000, nowMs - 10_000, nowMs - 1, now.toISOString()],
    );
    await db.run(
      `INSERT INTO presence_entries (
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
       VALUES (?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
      ["presence-fresh", nowMs - 10_000, nowMs - 10_000, nowMs + 60_000, now.toISOString()],
    );

    await db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "lane-old", "main", "worker-a", nowMs - 1],
    );
    await db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "lane-new", "main", "worker-b", nowMs + 60_000],
    );

    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "worker-a", nowMs - 1],
    );

    const extraWorkspaceId = randomUUID();
    await db.run(
      `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, extraWorkspaceId, "extra-workspace"],
    );
    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, extraWorkspaceId, "worker-b", nowMs + 60_000],
    );

    await db.run(
      `INSERT INTO oauth_pending (
         tenant_id,
         state,
         provider_id,
         agent_key,
         created_at,
         expires_at,
         pkce_verifier,
         redirect_uri,
         scopes,
         mode,
         metadata_json
       )
       VALUES (?, ?, 'openai', 'agent:default', ?, ?, 'verifier', 'http://localhost/callback', '[]', 'auth_code', '{}')`,
      [
        DEFAULT_TENANT_ID,
        "oauth-expired",
        new Date(nowMs - 60_000).toISOString(),
        new Date(nowMs - 1).toISOString(),
      ],
    );
    await db.run(
      `INSERT INTO oauth_pending (
         tenant_id,
         state,
         provider_id,
         agent_key,
         created_at,
         expires_at,
         pkce_verifier,
         redirect_uri,
         scopes,
         mode,
         metadata_json
       )
       VALUES (?, ?, 'openai', 'agent:default', ?, ?, 'verifier', 'http://localhost/callback', '[]', 'auth_code', '{}')`,
      [
        DEFAULT_TENANT_ID,
        "oauth-fresh",
        new Date(nowMs - 60_000).toISOString(),
        new Date(nowMs + 60_000).toISOString(),
      ],
    );

    const expiredAuthProfileId = randomUUID();
    const freshAuthProfileId = randomUUID();
    await db.run(
      `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
       VALUES (?, ?, ?, 'openai', 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, expiredAuthProfileId, "profile-expired"],
    );
    await db.run(
      `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
       VALUES (?, ?, ?, 'openai', 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, freshAuthProfileId, "profile-fresh"],
    );

    await db.run(
      `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, expiredAuthProfileId, "refresh-worker-a", nowMs - 1],
    );
    await db.run(
      `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, freshAuthProfileId, "refresh-worker-b", nowMs + 60_000],
    );

    await db.run(
      `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["models-expired", "catalog-worker-a", nowMs - 1],
    );
    await db.run(
      `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["models-fresh", "catalog-worker-b", nowMs + 60_000],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      metrics,
      sessionsTtlDays: 30,
    });

    await scheduler.tick();

    const presence = await db.all<{ instance_id: string }>(
      "SELECT instance_id FROM presence_entries ORDER BY instance_id ASC",
    );
    expect(presence).toEqual([{ instance_id: "presence-fresh" }]);

    const laneLeases = await db.all<{ key: string }>(
      "SELECT key FROM lane_leases WHERE tenant_id = ? ORDER BY key ASC",
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
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="lane_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="workspace_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="oauth_pending"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="oauth_refresh_leases"');
    expect(lifecycleMetrics).toContain('scheduler="statestore",table="models_dev_refresh_leases"');
  });

  it("retains completed inbox rows until dependent terminal outbox rows are pruned", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const oldReceivedAtMs = nowMs - threeDaysMs;
    const oldIso = new Date(oldReceivedAtMs).toISOString();

    const channelAccountId = randomUUID();
    await db.run(
      `INSERT INTO channel_accounts (tenant_id, workspace_id, channel_account_id, connector_key, account_key)
       VALUES (?, ?, ?, 'telegram', 'default')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId],
    );

    const threadId = randomUUID();
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadId, channelAccountId, "thread-retention"],
    );

    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-retention",
        "session-key-retention",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadId,
        now.toISOString(),
        now.toISOString(),
      ],
    );

    await db.run(
      `INSERT INTO channel_inbox (
         inbox_id,
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status,
         processed_at,
         reply_text,
         queue_mode,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, 'telegram', 'thread-retention', ?, 'agent:default:telegram:default:dm:thread-retention', 'main', ?, '{}', ?, ?, ?, 'collect', ?, ?, ?)`,
      [
        101,
        DEFAULT_TENANT_ID,
        "msg-completed",
        oldReceivedAtMs,
        "completed",
        oldIso,
        "reply",
        DEFAULT_WORKSPACE_ID,
        "session-retention",
        threadId,
      ],
    );
    await db.run(
      `INSERT INTO channel_inbox (
         inbox_id,
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status,
         processed_at,
         error,
         queue_mode,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, 'telegram', 'thread-retention', ?, 'agent:default:telegram:default:dm:thread-retention', 'main', ?, '{}', ?, ?, ?, 'collect', ?, ?, ?)`,
      [
        102,
        DEFAULT_TENANT_ID,
        "msg-failed",
        oldReceivedAtMs,
        "failed",
        oldIso,
        "boom",
        DEFAULT_WORKSPACE_ID,
        "session-retention",
        threadId,
      ],
    );

    await db.run(
      `INSERT INTO channel_outbox (
         outbox_id,
         tenant_id,
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         chunk_index,
         text,
         status,
         created_at,
         sent_at,
         error,
         workspace_id,
         session_id,
         channel_thread_id
       )
       VALUES (?, ?, ?, 'telegram', 'thread-retention', ?, 0, 'reply', 'failed', ?, ?, 'send failed', ?, ?, ?)`,
      [
        201,
        DEFAULT_TENANT_ID,
        101,
        "dedupe-retention-1",
        oldIso,
        oldIso,
        DEFAULT_WORKSPACE_ID,
        "session-retention",
        threadId,
      ],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
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

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();
    const expiredSessionUpdatedAt = "2026-02-22T00:00:00.000Z";

    const channelAccountId = randomUUID();
    await db.run(
      `INSERT INTO channel_accounts (tenant_id, workspace_id, channel_account_id, connector_key, account_key)
       VALUES (?, ?, ?, 'telegram', 'default')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId],
    );

    const threadA = randomUUID();
    const threadB = randomUUID();
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadA, channelAccountId, "thread-a"],
    );
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadB, channelAccountId, "thread-b"],
    );

    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-a",
        "session-key-a",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadA,
        now.toISOString(),
        expiredSessionUpdatedAt,
      ],
    );
    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-b",
        "session-key-b",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadB,
        now.toISOString(),
        expiredSessionUpdatedAt,
      ],
    );

    await db.run(
      `INSERT INTO context_reports (
         tenant_id,
         context_report_id,
         session_id,
         channel,
         thread_id,
         agent_id,
         workspace_id,
         report_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "cr-a",
        "session-a",
        "telegram",
        "thread-a",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "{}",
        now.toISOString(),
      ],
    );
    await db.run(
      `INSERT INTO context_reports (
         tenant_id,
         context_report_id,
         session_id,
         channel,
         thread_id,
         agent_id,
         workspace_id,
         report_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "cr-b",
        "session-b",
        "telegram",
        "thread-b",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "{}",
        now.toISOString(),
      ],
    );

    class UnstableSessionTieBreakDb implements SqlDb {
      readonly kind: SqlDb["kind"];

      constructor(private readonly base: SqlDb) {
        this.kind = base.kind;
      }

      get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
        return this.base.get(sql, params);
      }

      all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return this.base.all(sql, params);
      }

      async run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }> {
        const hasUnstableOrderBy =
          /ORDER BY updated_at ASC\s+LIMIT \?/i.test(sql) &&
          !/ORDER BY updated_at ASC,\s*session_id/i.test(sql);

        if (!hasUnstableOrderBy) {
          return await this.base.run(sql, params);
        }

        const injectTieBreak = (direction: "ASC" | "DESC"): string =>
          sql.replace(
            /ORDER BY updated_at ASC(\s+LIMIT \?)/i,
            `ORDER BY updated_at ASC, session_id ${direction}$1`,
          );

        // Simulate a database choosing different tie-breakers for separate DELETE statements
        // when ORDER BY does not fully order the result set.
        if (/DELETE FROM context_reports/i.test(sql)) {
          return await this.base.run(injectTieBreak("ASC"), params);
        }
        if (/DELETE FROM sessions/i.test(sql)) {
          return await this.base.run(injectTieBreak("DESC"), params);
        }

        return await this.base.run(sql, params);
      }

      exec(sql: string): Promise<void> {
        return this.base.exec(sql);
      }

      transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
        return this.base.transaction(async (tx) => fn(new UnstableSessionTieBreakDb(tx)));
      }

      close(): Promise<void> {
        return this.base.close();
      }
    }

    const scheduler = new StateStoreLifecycleScheduler({
      db: new UnstableSessionTieBreakDb(db),
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      batchSize: 1,
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    const orphaned = await db.all<{ context_report_id: string; session_id: string }>(
      `SELECT context_report_id, session_id
       FROM context_reports
       WHERE (tenant_id, session_id) NOT IN (SELECT tenant_id, session_id FROM sessions)
       ORDER BY context_report_id ASC`,
    );
    expect(orphaned).toEqual([]);
  });

  it("avoids datetime(updated_at) in SQLite session pruning queries (index-friendly)", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();

    const runs: string[] = [];

    class RecordingDb implements SqlDb {
      readonly kind: SqlDb["kind"];

      constructor(private readonly base: SqlDb) {
        this.kind = base.kind;
      }

      get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
        return this.base.get(sql, params);
      }

      all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
        return this.base.all(sql, params);
      }

      async run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }> {
        runs.push(sql);
        return await this.base.run(sql, params);
      }

      exec(sql: string): Promise<void> {
        return this.base.exec(sql);
      }

      transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
        return this.base.transaction(async (tx) => fn(new RecordingDb(tx)));
      }

      close(): Promise<void> {
        return this.base.close();
      }
    }

    const scheduler = new StateStoreLifecycleScheduler({
      db: new RecordingDb(db),
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      sessionsTtlDays: 1,
    });

    await scheduler.tick();

    expect(runs.some((sql) => /datetime\s*\(\s*updated_at\s*\)/i.test(sql))).toBe(false);
    expect(runs.some((sql) => /WHERE\s+updated_at\s*<\s*\?/i.test(sql))).toBe(true);
  });

  it("does not floor fractional session TTL days to zero (data-loss guard)", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:00:00.000Z");
    const nowMs = now.getTime();

    const sessionUpdatedAt = new Date(nowMs - 1000).toISOString();

    const channelAccountId = randomUUID();
    await db.run(
      `INSERT INTO channel_accounts (tenant_id, workspace_id, channel_account_id, connector_key, account_key)
       VALUES (?, ?, ?, 'telegram', 'default')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId],
    );

    const threadId = randomUUID();
    await db.run(
      `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
       VALUES (?, ?, ?, ?, ?, 'dm')`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, threadId, channelAccountId, "thread-ttl"],
    );

    await db.run(
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-recent",
        "session-key-recent",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        threadId,
        now.toISOString(),
        sessionUpdatedAt,
      ],
    );

    const scheduler = new StateStoreLifecycleScheduler({
      db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      sessionsTtlDays: 0.5,
    });

    await scheduler.tick();

    const sessions = await db.all<{ session_id: string }>(
      "SELECT session_id FROM sessions WHERE tenant_id = ? ORDER BY session_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(sessions).toEqual([{ session_id: "session-recent" }]);
  });
});
