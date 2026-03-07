import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ids, legacyIds } from "./fk-audit-contract.fixtures.js";

type SqliteRunner = {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
  };
};

type PostgresClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

export const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");
export const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

export function seedSqliteScope(db: SqliteRunner): void {
  db.prepare("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)").run(
    ids.tenantId,
    "fk-audit-tenant",
  );
  db.prepare("INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)").run(
    ids.tenantId,
    ids.agentId,
    "fk-audit-agent",
  );
  db.prepare(
    "INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)",
  ).run(ids.tenantId, ids.workspaceId, "fk-audit-workspace");
  db.prepare(
    "INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)",
  ).run(ids.tenantId, ids.agentId, ids.workspaceId);
  db.prepare(
    `INSERT INTO channel_accounts (
       tenant_id,
       workspace_id,
       channel_account_id,
       connector_key,
       account_key
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(ids.tenantId, ids.workspaceId, ids.channelAccountId, "telegram", "work");
  db.prepare(
    `INSERT INTO channel_threads (
       tenant_id,
       workspace_id,
       channel_thread_id,
       channel_account_id,
       provider_thread_id,
       container_kind
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ids.tenantId, ids.workspaceId, ids.channelThreadId, ids.channelAccountId, "thread-1", "dm");
  db.prepare(
    `INSERT INTO sessions (
       tenant_id,
       session_id,
       session_key,
       agent_id,
       workspace_id,
       channel_thread_id
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.tenantId,
    ids.sessionId,
    "fk-audit-session",
    ids.agentId,
    ids.workspaceId,
    ids.channelThreadId,
  );
  db.prepare(
    `INSERT INTO channel_inbox (
       tenant_id,
       source,
       thread_id,
       message_id,
       key,
       lane,
       received_at_ms,
       payload_json,
       workspace_id,
       session_id,
       channel_thread_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.tenantId,
    "telegram:work",
    "thread-1",
    "message-1",
    "fk-audit-session",
    "main",
    1,
    "{}",
    ids.workspaceId,
    ids.sessionId,
    ids.channelThreadId,
  );
}

export async function seedPostgresScope(client: PostgresClient): Promise<void> {
  await client.query("INSERT INTO tenants (tenant_id, tenant_key) VALUES ($1, $2)", [
    ids.tenantId,
    "fk-audit-tenant",
  ]);
  await client.query("INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES ($1, $2, $3)", [
    ids.tenantId,
    ids.agentId,
    "fk-audit-agent",
  ]);
  await client.query(
    "INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES ($1, $2, $3)",
    [ids.tenantId, ids.workspaceId, "fk-audit-workspace"],
  );
  await client.query(
    "INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES ($1, $2, $3)",
    [ids.tenantId, ids.agentId, ids.workspaceId],
  );
  await client.query(
    `INSERT INTO channel_accounts (
       tenant_id,
       workspace_id,
       channel_account_id,
       connector_key,
       account_key
     ) VALUES ($1, $2, $3, $4, $5)`,
    [ids.tenantId, ids.workspaceId, ids.channelAccountId, "telegram", "work"],
  );
  await client.query(
    `INSERT INTO channel_threads (
       tenant_id,
       workspace_id,
       channel_thread_id,
       channel_account_id,
       provider_thread_id,
       container_kind
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [ids.tenantId, ids.workspaceId, ids.channelThreadId, ids.channelAccountId, "thread-1", "dm"],
  );
  await client.query(
    `INSERT INTO sessions (
       tenant_id,
       session_id,
       session_key,
       agent_id,
       workspace_id,
       channel_thread_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      ids.tenantId,
      ids.sessionId,
      "fk-audit-session",
      ids.agentId,
      ids.workspaceId,
      ids.channelThreadId,
    ],
  );
  await client.query(
    `INSERT INTO channel_inbox (
       tenant_id,
       source,
       thread_id,
       message_id,
       key,
       lane,
       received_at_ms,
       payload_json,
       workspace_id,
       session_id,
       channel_thread_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ids.tenantId,
      "telegram:work",
      "thread-1",
      "message-1",
      "fk-audit-session",
      "main",
      1,
      "{}",
      ids.workspaceId,
      ids.sessionId,
      ids.channelThreadId,
    ],
  );
}

export function copyMigrationsBefore(sourceDir: string, upperExclusive: string): string {
  const targetDir = mkdtempSync(join(tmpdir(), "tyrum-fk-audit-migrations-"));
  for (const file of readdirSync(sourceDir)
    .filter((name) => name.endsWith(".sql") && name < upperExclusive)
    .toSorted()) {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
  }
  return targetDir;
}

export async function applyPostgresMigration(
  client: PostgresClient,
  migrationsDir: string,
  migrationFile: string,
): Promise<void> {
  const sql = readFileSync(join(migrationsDir, migrationFile), "utf-8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [migrationFile]);
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration failure.
    }
    throw err;
  }
}

export function seedSqliteLegacyOrphans(db: SqliteRunner): void {
  db.prepare(
    `INSERT INTO approvals (
       tenant_id,
       approval_id,
       approval_key,
       agent_id,
       workspace_id,
       kind,
       status,
       prompt,
       run_id,
       step_id,
       attempt_id
     ) VALUES (?, ?, ?, ?, ?, 'policy', 'pending', ?, ?, ?, ?)`,
  ).run(
    ids.tenantId,
    legacyIds.approvalId,
    "approval:fk-audit:legacy",
    ids.agentId,
    ids.workspaceId,
    "legacy orphan refs",
    legacyIds.runId,
    legacyIds.stepId,
    legacyIds.attemptId,
  );
  db.prepare(
    `INSERT INTO policy_overrides (
       tenant_id,
       policy_override_id,
       override_key,
       status,
       agent_id,
       workspace_id,
       tool_id,
       pattern,
       created_from_approval_id,
       created_by_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.tenantId,
    legacyIds.policyOverrideId,
    "override:fk-audit:legacy",
    ids.agentId,
    ids.workspaceId,
    "connector.send",
    "telegram:work:thread-1",
    legacyIds.missingApprovalId,
    "{}",
    "2026-03-05T10:00:00.000Z",
    "2026-03-05T10:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO channel_outbox (
       tenant_id,
       inbox_id,
       source,
       thread_id,
       dedupe_key,
       chunk_index,
       text,
       approval_id,
       workspace_id,
       session_id,
       channel_thread_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.tenantId,
    1,
    "telegram:work",
    "thread-1",
    "fk-audit:legacy-outbox",
    0,
    "hello",
    legacyIds.missingApprovalId,
    ids.workspaceId,
    ids.sessionId,
    ids.channelThreadId,
  );
}

export async function seedPostgresLegacyOrphans(client: PostgresClient): Promise<void> {
  await client.query(
    `INSERT INTO approvals (
       tenant_id,
       approval_id,
       approval_key,
       agent_id,
       workspace_id,
       kind,
       status,
       prompt,
       run_id,
       step_id,
       attempt_id
     ) VALUES ($1, $2, $3, $4, $5, 'policy', 'pending', $6, $7, $8, $9)`,
    [
      ids.tenantId,
      legacyIds.approvalId,
      "approval:fk-audit:legacy",
      ids.agentId,
      ids.workspaceId,
      "legacy orphan refs",
      legacyIds.runId,
      legacyIds.stepId,
      legacyIds.attemptId,
    ],
  );
  await client.query(
    `INSERT INTO policy_overrides (
       tenant_id,
       policy_override_id,
       override_key,
       status,
       agent_id,
       workspace_id,
       tool_id,
       pattern,
       created_from_approval_id,
       created_by_json,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ids.tenantId,
      legacyIds.policyOverrideId,
      "override:fk-audit:legacy",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      legacyIds.missingApprovalId,
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  );
  await client.query(
    `INSERT INTO channel_outbox (
       tenant_id,
       inbox_id,
       source,
       thread_id,
       dedupe_key,
       chunk_index,
       text,
       approval_id,
       workspace_id,
       session_id,
       channel_thread_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:legacy-outbox",
      0,
      "hello",
      legacyIds.missingApprovalId,
      ids.workspaceId,
      ids.sessionId,
      ids.channelThreadId,
    ],
  );
}
