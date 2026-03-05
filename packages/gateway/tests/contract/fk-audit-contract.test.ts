import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

const ids = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  agentId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
  channelAccountId: "10000000-0000-4000-8000-000000000004",
  channelThreadId: "10000000-0000-4000-8000-000000000005",
  sessionId: "10000000-0000-4000-8000-000000000006",
} as const;

const legacyIds = {
  approvalId: "10000000-0000-4000-8000-000000000120",
  runId: "10000000-0000-4000-8000-000000000121",
  stepId: "10000000-0000-4000-8000-000000000122",
  attemptId: "10000000-0000-4000-8000-000000000123",
  missingApprovalId: "10000000-0000-4000-8000-000000000124",
  policyOverrideId: "10000000-0000-4000-8000-000000000125",
} as const;

type SqliteCase = {
  name: string;
  sql: string;
  params: readonly unknown[];
};

type PostgresCase = {
  name: string;
  sql: string;
  params: readonly unknown[];
};

const sqliteCases: SqliteCase[] = [
  {
    name: "channel_outbox.approval_id",
    sql: `INSERT INTO channel_outbox (
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
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:outbox",
      0,
      "hello",
      "00000000-0000-4000-8000-000000000111",
      ids.workspaceId,
      ids.sessionId,
      ids.channelThreadId,
    ],
  },
  {
    name: "policy_overrides.created_from_approval_id",
    sql: `INSERT INTO policy_overrides (
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
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000112",
      "override:fk-audit",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      "00000000-0000-4000-8000-000000000113",
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    name: "approvals.run_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            run_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'pending', ?, ?)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000114",
      "approval:fk-audit:run",
      ids.agentId,
      ids.workspaceId,
      "invalid run",
      "00000000-0000-4000-8000-000000000115",
    ],
  },
  {
    name: "approvals.step_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            step_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'pending', ?, ?)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000116",
      "approval:fk-audit:step",
      ids.agentId,
      ids.workspaceId,
      "invalid step",
      "00000000-0000-4000-8000-000000000117",
    ],
  },
  {
    name: "approvals.attempt_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            attempt_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'pending', ?, ?)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000118",
      "approval:fk-audit:attempt",
      ids.agentId,
      ids.workspaceId,
      "invalid attempt",
      "00000000-0000-4000-8000-000000000119",
    ],
  },
];

const postgresCases: PostgresCase[] = [
  {
    name: "channel_outbox.approval_id",
    sql: `INSERT INTO channel_outbox (
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
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:outbox",
      0,
      "hello",
      "00000000-0000-4000-8000-000000000111",
      ids.workspaceId,
      ids.sessionId,
      ids.channelThreadId,
    ],
  },
  {
    name: "policy_overrides.created_from_approval_id",
    sql: `INSERT INTO policy_overrides (
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
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000112",
      "override:fk-audit",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      "00000000-0000-4000-8000-000000000113",
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    name: "approvals.run_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            run_id
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'pending', $6, $7)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000114",
      "approval:fk-audit:run",
      ids.agentId,
      ids.workspaceId,
      "invalid run",
      "00000000-0000-4000-8000-000000000115",
    ],
  },
  {
    name: "approvals.step_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            step_id
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'pending', $6, $7)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000116",
      "approval:fk-audit:step",
      ids.agentId,
      ids.workspaceId,
      "invalid step",
      "00000000-0000-4000-8000-000000000117",
    ],
  },
  {
    name: "approvals.attempt_id",
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            attempt_id
          ) VALUES ($1, $2, $3, $4, $5, 'policy', 'pending', $6, $7)`,
    params: [
      ids.tenantId,
      "00000000-0000-4000-8000-000000000118",
      "approval:fk-audit:attempt",
      ids.agentId,
      ids.workspaceId,
      "invalid attempt",
      "00000000-0000-4000-8000-000000000119",
    ],
  },
];

function seedSqliteScope(db: ReturnType<typeof createDatabase>): void {
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

async function seedPostgresScope(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
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

function copyMigrationsBefore(sourceDir: string, upperExclusive: string): string {
  const targetDir = mkdtempSync(join(tmpdir(), "tyrum-fk-audit-migrations-"));
  for (const file of readdirSync(sourceDir)
    .filter((name) => name.endsWith(".sql") && name < upperExclusive)
    .sort()) {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
  }
  return targetDir;
}

async function applyPostgresMigration(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
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

function seedSqliteLegacyOrphans(db: ReturnType<typeof createDatabase>): void {
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

async function seedPostgresLegacyOrphans(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
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

describe("FK audit contract", () => {
  it("rejects invalid enforced references in sqlite", () => {
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    try {
      seedSqliteScope(sqlite);

      for (const testCase of sqliteCases) {
        expect(() => sqlite.prepare(testCase.sql).run(...testCase.params), testCase.name).toThrow();
      }
    } finally {
      sqlite.close();
    }
  });

  it("rejects invalid enforced references in postgres", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();

    try {
      await migratePostgres(pg, postgresMigrationsDir);
      await seedPostgresScope(pg);

      for (const testCase of postgresCases) {
        await expect(pg.query(testCase.sql, [...testCase.params]), testCase.name).rejects.toThrow();
      }
    } finally {
      await pg.end();
    }
  });

  it("normalizes legacy orphaned refs during sqlite upgrades", () => {
    const sqlite = createDatabase(":memory:");
    const pre110Dir = copyMigrationsBefore(sqliteMigrationsDir, "110_");

    try {
      migrate(sqlite, pre110Dir);
      seedSqliteScope(sqlite);
      seedSqliteLegacyOrphans(sqlite);

      migrate(sqlite, sqliteMigrationsDir);

      const approval = sqlite
        .prepare(
          `SELECT run_id, step_id, attempt_id
           FROM approvals
           WHERE tenant_id = ? AND approval_id = ?`,
        )
        .get(ids.tenantId, legacyIds.approvalId) as
        | { run_id: string | null; step_id: string | null; attempt_id: string | null }
        | undefined;
      expect(approval).toEqual({ run_id: null, step_id: null, attempt_id: null });

      const override = sqlite
        .prepare(
          `SELECT created_from_approval_id
           FROM policy_overrides
           WHERE tenant_id = ? AND policy_override_id = ?`,
        )
        .get(ids.tenantId, legacyIds.policyOverrideId) as
        | { created_from_approval_id: string | null }
        | undefined;
      expect(override).toEqual({ created_from_approval_id: null });

      const outbox = sqlite
        .prepare(
          `SELECT approval_id
           FROM channel_outbox
           WHERE tenant_id = ? AND dedupe_key = ?`,
        )
        .get(ids.tenantId, "fk-audit:legacy-outbox") as { approval_id: string | null } | undefined;
      expect(outbox).toEqual({ approval_id: null });
    } finally {
      rmSync(pre110Dir, { recursive: true, force: true });
      sqlite.close();
    }
  });

  it("normalizes legacy orphaned refs during postgres upgrades", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    const pre110Dir = copyMigrationsBefore(postgresMigrationsDir, "110_");
    await pg.connect();

    try {
      await migratePostgres(pg, pre110Dir);
      await seedPostgresScope(pg);
      await seedPostgresLegacyOrphans(pg);

      // pg-mem rejects replaying the CREATE TABLE IF NOT EXISTS _migrations DDL,
      // so apply only the pending upgrade file on the second migration leg.
      await applyPostgresMigration(
        pg,
        postgresMigrationsDir,
        "110_fk_audit_policy_approval_refs.sql",
      );

      const approvalRes = await pg.query(
        `SELECT run_id, step_id, attempt_id
         FROM approvals
         WHERE tenant_id = $1 AND approval_id = $2`,
        [ids.tenantId, legacyIds.approvalId],
      );
      expect(approvalRes.rows[0]).toMatchObject({
        run_id: null,
        step_id: null,
        attempt_id: null,
      });

      const overrideRes = await pg.query(
        `SELECT created_from_approval_id
         FROM policy_overrides
         WHERE tenant_id = $1 AND policy_override_id = $2`,
        [ids.tenantId, legacyIds.policyOverrideId],
      );
      expect(overrideRes.rows[0]).toMatchObject({ created_from_approval_id: null });

      const outboxRes = await pg.query(
        `SELECT approval_id
         FROM channel_outbox
         WHERE tenant_id = $1 AND dedupe_key = $2`,
        [ids.tenantId, "fk-audit:legacy-outbox"],
      );
      expect(outboxRes.rows[0]).toMatchObject({ approval_id: null });
    } finally {
      rmSync(pre110Dir, { recursive: true, force: true });
      await pg.end();
    }
  });
});
