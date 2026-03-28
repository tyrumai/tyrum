import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { GatewayContainer } from "../../src/container.js";
import { OutboxLifecycleScheduler } from "../../src/modules/backplane/outbox-lifecycle.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import { StateStoreLifecycleScheduler } from "../../src/modules/statestore/lifecycle.js";
import { createTestContainer } from "./helpers.js";

describe("operational maintenance jobs", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
  });

  it("prunes expired operational rows with the background schedulers", async () => {
    container = await createTestContainer();

    const now = new Date("2026-02-24T00:10:00.000Z");
    const nowMs = now.getTime();
    const metrics = new MetricsRegistry();

    await container.db.run(
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
        DEFAULT_TENANT_ID,
        "presence-expired",
        nowMs - 10_000,
        nowMs - 10_000,
        nowMs - 1,
        now.toISOString(),
      ],
    );
    await container.db.run(
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
        DEFAULT_TENANT_ID,
        "presence-fresh",
        nowMs - 10_000,
        nowMs - 10_000,
        nowMs + 60_000,
        now.toISOString(),
      ],
    );

    await container.db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "conversation-expired", "worker-a", nowMs - 1],
    );
    await container.db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "conversation-fresh", "worker-b", nowMs + 60_000],
    );

    const extraWorkspaceId = randomUUID();
    await container.db.run(
      `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, extraWorkspaceId, "maintenance-workspace"],
    );
    await container.db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "worker-a", nowMs - 1],
    );
    await container.db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, extraWorkspaceId, "worker-b", nowMs + 60_000],
    );

    await container.db.run(
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
    await container.db.run(
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
    await container.db.run(
      `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
       VALUES (?, ?, ?, 'openai', 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, expiredAuthProfileId, "profile-expired"],
    );
    await container.db.run(
      `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
       VALUES (?, ?, ?, 'openai', 'api_key', 'active')`,
      [DEFAULT_TENANT_ID, freshAuthProfileId, "profile-fresh"],
    );
    await container.db.run(
      `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, expiredAuthProfileId, "refresh-worker-a", nowMs - 1],
    );
    await container.db.run(
      `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, freshAuthProfileId, "refresh-worker-b", nowMs + 60_000],
    );

    await container.db.run(
      `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["models-expired", "catalog-worker-a", nowMs - 1],
    );
    await container.db.run(
      `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["models-fresh", "catalog-worker-b", nowMs + 60_000],
    );

    await container.db.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", "2026-02-24T00:04:59.000Z"],
    );
    await container.db.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", "2026-02-24T00:05:01.000Z"],
    );
    await container.db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "edge-expired", 0, "2026-02-24T00:04:59.000Z"],
    );
    await container.db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "edge-fresh", 0, "2026-02-24T00:05:01.000Z"],
    );

    const stateStoreScheduler = new StateStoreLifecycleScheduler({
      db: container.db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      metrics,
      conversationsTtlDays: 30,
    });
    const outboxScheduler = new OutboxLifecycleScheduler({
      db: container.db,
      clock: () => ({ nowIso: now.toISOString(), nowMs }),
      metrics,
      retentionMs: 5 * 60_000,
    });

    await stateStoreScheduler.tick();
    await outboxScheduler.tick();

    const presence = await container.db.all<{ instance_id: string }>(
      "SELECT instance_id FROM presence_entries ORDER BY instance_id ASC",
    );
    expect(presence).toEqual([{ instance_id: "presence-fresh" }]);

    const conversationLeases = await container.db.all<{ key: string }>(
      "SELECT conversation_key AS key FROM conversation_leases WHERE tenant_id = ? ORDER BY conversation_key ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(conversationLeases).toEqual([{ key: "conversation-fresh" }]);

    const workspaceLeases = await container.db.all<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspace_leases WHERE tenant_id = ? ORDER BY workspace_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(workspaceLeases).toEqual([{ workspace_id: extraWorkspaceId }]);

    const oauthPending = await container.db.all<{ state: string }>(
      "SELECT state FROM oauth_pending WHERE tenant_id = ? ORDER BY state ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(oauthPending).toEqual([{ state: "oauth-fresh" }]);

    const oauthRefreshLeases = await container.db.all<{ auth_profile_id: string }>(
      `SELECT auth_profile_id
       FROM oauth_refresh_leases
       WHERE tenant_id = ?
       ORDER BY auth_profile_id ASC`,
      [DEFAULT_TENANT_ID],
    );
    expect(oauthRefreshLeases).toEqual([{ auth_profile_id: freshAuthProfileId }]);

    const modelsRefreshLeases = await container.db.all<{ key: string }>(
      "SELECT key FROM models_dev_refresh_leases ORDER BY key ASC",
    );
    expect(modelsRefreshLeases).toEqual([{ key: "models-fresh" }]);

    const outboxRows = await container.db.all<{ created_at: string }>(
      "SELECT created_at FROM outbox WHERE tenant_id = ? ORDER BY created_at ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(outboxRows).toEqual([{ created_at: "2026-02-24T00:05:01.000Z" }]);

    const outboxConsumers = await container.db.all<{ consumer_id: string }>(
      "SELECT consumer_id FROM outbox_consumers WHERE tenant_id = ? ORDER BY consumer_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(outboxConsumers).toEqual([{ consumer_id: "edge-fresh" }]);

    const lifecycleMetrics = await metrics.registry.metrics();
    expect(lifecycleMetrics).toContain(
      'lifecycle_prune_rows_total{scheduler="statestore",table="presence_entries"} 1',
    );
    expect(lifecycleMetrics).toContain(
      'lifecycle_prune_rows_total{scheduler="outbox",table="outbox"} 1',
    );
  });
});
