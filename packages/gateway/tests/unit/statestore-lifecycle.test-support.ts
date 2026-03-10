import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";

export type LifecycleTestClock = {
  now: Date;
  nowIso: string;
  nowMs: number;
  clock: () => { nowIso: string; nowMs: number };
};

export function createLifecycleTestClock(
  now = new Date("2026-02-24T00:00:00.000Z"),
): LifecycleTestClock {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  return {
    now,
    nowIso,
    nowMs,
    clock: () => ({ nowIso, nowMs }),
  };
}

type SessionSeed = {
  sessionId: string;
  sessionKey: string;
  channelThreadId: string;
  createdAt: string;
  updatedAt: string;
};

async function insertChannelAccount(db: SqlDb): Promise<string> {
  const channelAccountId = randomUUID();
  await db.run(
    `INSERT INTO channel_accounts (tenant_id, workspace_id, channel_account_id, connector_key, account_key)
     VALUES (?, ?, ?, 'telegram', 'default')`,
    [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelAccountId],
  );
  return channelAccountId;
}

async function insertChannelThread(
  db: SqlDb,
  channelAccountId: string,
  providerThreadId: string,
): Promise<string> {
  const channelThreadId = randomUUID();
  await db.run(
    `INSERT INTO channel_threads (tenant_id, workspace_id, channel_thread_id, channel_account_id, provider_thread_id, container_kind)
     VALUES (?, ?, ?, ?, ?, 'dm')`,
    [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, channelThreadId, channelAccountId, providerThreadId],
  );
  return channelThreadId;
}

async function insertSession(db: SqlDb, seed: SessionSeed): Promise<void> {
  await db.run(
    `INSERT INTO sessions (
       tenant_id,
       session_id,
       session_key,
       agent_id,
       workspace_id,
       channel_thread_id,
       summary,
       transcript_json,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      seed.sessionId,
      seed.sessionKey,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      seed.channelThreadId,
      seed.createdAt,
      seed.updatedAt,
    ],
  );
}

async function insertAuthProfile(
  db: SqlDb,
  authProfileKey: string,
  authProfileId = randomUUID(),
): Promise<string> {
  await db.run(
    `INSERT INTO auth_profiles (tenant_id, auth_profile_id, auth_profile_key, provider_key, type, status)
     VALUES (?, ?, ?, 'openai', 'api_key', 'active')`,
    [DEFAULT_TENANT_ID, authProfileId, authProfileKey],
  );
  return authProfileId;
}

async function insertContextReport(
  db: SqlDb,
  contextReportId: string,
  sessionId: string,
  threadId: string,
  createdAt: string,
): Promise<void> {
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
      contextReportId,
      sessionId,
      "telegram",
      threadId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "{}",
      createdAt,
    ],
  );
}

export async function seedSessionPruneFixture(db: SqlDb, now: LifecycleTestClock): Promise<void> {
  const channelAccountId = await insertChannelAccount(db);
  const threadExpired = await insertChannelThread(db, channelAccountId, "thread-1");
  const threadFresh = await insertChannelThread(db, channelAccountId, "thread-2");

  await insertSession(db, {
    sessionId: "session-expired",
    sessionKey: "session-key-expired",
    channelThreadId: threadExpired,
    createdAt: now.nowIso,
    updatedAt: "2026-02-22T23:59:59.000Z",
  });
  await insertSession(db, {
    sessionId: "session-fresh",
    sessionKey: "session-key-fresh",
    channelThreadId: threadFresh,
    createdAt: now.nowIso,
    updatedAt: "2026-02-23T00:00:01.000Z",
  });

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

  const authProfileId = await insertAuthProfile(db, "profile-1");
  await db.run(
    `INSERT INTO session_provider_pins (tenant_id, session_id, provider_key, auth_profile_id)
     VALUES (?, ?, 'openai', ?)`,
    [DEFAULT_TENANT_ID, "session-expired", authProfileId],
  );

  await insertContextReport(db, "cr-1", "session-expired", "thread-1", now.nowIso);

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
      now.nowMs - 10_000,
      now.nowMs - 10_000,
      now.nowMs - 1,
    ],
  );
  await db.run(
    `INSERT INTO connections (tenant_id, connection_id, edge_id, principal_id, connected_at_ms, last_seen_at_ms, expires_at_ms)
     VALUES (?, ?, 'edge-1', ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "conn-fresh",
      "principal-fresh",
      now.nowMs - 10_000,
      now.nowMs - 10_000,
      now.nowMs + 60_000,
    ],
  );

  await db.run(
    `INSERT INTO channel_inbound_dedupe (tenant_id, channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
     VALUES (?, 'telegram', 'default', 'thread-1', ?, NULL, ?)`,
    [DEFAULT_TENANT_ID, "msg-expired", now.nowMs - 1],
  );
  await db.run(
    `INSERT INTO channel_inbound_dedupe (tenant_id, channel, account_id, container_id, message_id, inbox_id, expires_at_ms)
     VALUES (?, 'telegram', 'default', 'thread-1', ?, NULL, ?)`,
    [DEFAULT_TENANT_ID, "msg-fresh", now.nowMs + 60_000],
  );
}

export async function seedOperationalPruneFixture(
  db: SqlDb,
  now: LifecycleTestClock,
): Promise<{ extraWorkspaceId: string; freshAuthProfileId: string }> {
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
    ["presence-expired", now.nowMs - 10_000, now.nowMs - 10_000, now.nowMs - 1, now.nowIso],
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
    ["presence-fresh", now.nowMs - 10_000, now.nowMs - 10_000, now.nowMs + 60_000, now.nowIso],
  );

  await db.run(
    `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, "lane-old", "main", "worker-a", now.nowMs - 1],
  );
  await db.run(
    `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, "lane-new", "main", "worker-b", now.nowMs + 60_000],
  );

  await db.run(
    `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "worker-a", now.nowMs - 1],
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
    [DEFAULT_TENANT_ID, extraWorkspaceId, "worker-b", now.nowMs + 60_000],
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
      new Date(now.nowMs - 60_000).toISOString(),
      new Date(now.nowMs - 1).toISOString(),
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
      new Date(now.nowMs - 60_000).toISOString(),
      new Date(now.nowMs + 60_000).toISOString(),
    ],
  );

  const expiredAuthProfileId = await insertAuthProfile(db, "profile-expired");
  const freshAuthProfileId = await insertAuthProfile(db, "profile-fresh");

  await db.run(
    `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, expiredAuthProfileId, "refresh-worker-a", now.nowMs - 1],
  );
  await db.run(
    `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, freshAuthProfileId, "refresh-worker-b", now.nowMs + 60_000],
  );

  await db.run(
    `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?)`,
    ["models-expired", "catalog-worker-a", now.nowMs - 1],
  );
  await db.run(
    `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
     VALUES (?, ?, ?)`,
    ["models-fresh", "catalog-worker-b", now.nowMs + 60_000],
  );

  return { extraWorkspaceId, freshAuthProfileId };
}

export async function seedChannelRetentionFixture(
  db: SqlDb,
  now: LifecycleTestClock,
): Promise<void> {
  const oldReceivedAtMs = now.nowMs - 3 * 24 * 60 * 60 * 1000;
  const oldIso = new Date(oldReceivedAtMs).toISOString();

  const channelAccountId = await insertChannelAccount(db);
  const channelThreadId = await insertChannelThread(db, channelAccountId, "thread-retention");

  await insertSession(db, {
    sessionId: "session-retention",
    sessionKey: "session-key-retention",
    channelThreadId,
    createdAt: now.nowIso,
    updatedAt: now.nowIso,
  });

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
      channelThreadId,
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
      channelThreadId,
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
      channelThreadId,
    ],
  );
}

export async function seedSessionTieFixture(db: SqlDb, now: LifecycleTestClock): Promise<void> {
  const channelAccountId = await insertChannelAccount(db);
  const threadA = await insertChannelThread(db, channelAccountId, "thread-a");
  const threadB = await insertChannelThread(db, channelAccountId, "thread-b");
  const expiredSessionUpdatedAt = "2026-02-22T00:00:00.000Z";

  await insertSession(db, {
    sessionId: "session-a",
    sessionKey: "session-key-a",
    channelThreadId: threadA,
    createdAt: now.nowIso,
    updatedAt: expiredSessionUpdatedAt,
  });
  await insertSession(db, {
    sessionId: "session-b",
    sessionKey: "session-key-b",
    channelThreadId: threadB,
    createdAt: now.nowIso,
    updatedAt: expiredSessionUpdatedAt,
  });

  await insertContextReport(db, "cr-a", "session-a", "thread-a", now.nowIso);
  await insertContextReport(db, "cr-b", "session-b", "thread-b", now.nowIso);
}

export async function seedFractionalSessionTtlFixture(
  db: SqlDb,
  now: LifecycleTestClock,
): Promise<void> {
  const channelAccountId = await insertChannelAccount(db);
  const threadId = await insertChannelThread(db, channelAccountId, "thread-ttl");

  await insertSession(db, {
    sessionId: "session-recent",
    sessionKey: "session-key-recent",
    channelThreadId: threadId,
    createdAt: now.nowIso,
    updatedAt: new Date(now.nowMs - 1000).toISOString(),
  });
}
