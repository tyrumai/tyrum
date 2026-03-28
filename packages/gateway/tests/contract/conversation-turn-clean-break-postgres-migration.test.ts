import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");
const migrationFile = "153_conversation_turn_clean_break.sql";
const migrationSql = readFileSync(join(postgresMigrationsDir, migrationFile), "utf8");

function copyMigrationsBefore(sourceDir: string, upperExclusive: string): string {
  const targetDir = mkdtempSync(join(tmpdir(), "tyrum-clean-break-pre153-"));
  for (const file of readdirSync(sourceDir)
    .filter((name) => name.endsWith(".sql") && name < upperExclusive)
    .toSorted()) {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
  }
  return targetDir;
}

function copyMigrationOnly(sourceDir: string, file: string): string {
  const targetDir = mkdtempSync(join(tmpdir(), "tyrum-clean-break-153-"));
  copyFileSync(join(sourceDir, file), join(targetDir, file));
  return targetDir;
}

async function applyPostgresMigration(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  sql: string,
  file: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
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

describe("conversation turn clean-break postgres migration", () => {
  it("guards blank updated_at and malformed messages_json in SQL", () => {
    expect(migrationSql).toContain("NULLIF(context_state_json ->> 'updated_at', '')::timestamptz");
    expect(migrationSql).toContain("pg_input_is_valid(c.messages_json, 'jsonb')");
    expect(migrationSql).toContain("jsonb_typeof(c.messages_json::jsonb) = 'array'");
  });

  it("migrates malformed legacy conversation rows without aborting", async () => {
    const pre153Dir = copyMigrationsBefore(postgresMigrationsDir, migrationFile);
    const cutoverDir = copyMigrationOnly(postgresMigrationsDir, migrationFile);
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();

    await pg.connect();
    try {
      await migratePostgres(pg, pre153Dir);

      const ids = {
        tenantId: "00000000-0000-4000-8000-00000000c153",
        agentId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        channelAccountId: "33333333-3333-4333-8333-333333333333",
        channelThreadId: "44444444-4444-4444-8444-444444444444",
        conversationId: "55555555-5555-4555-8555-555555555555",
      } as const;

      await pg.query(
        `INSERT INTO tenants (tenant_id, tenant_key)
         VALUES ($1, 'cutover-test')`,
        [ids.tenantId],
      );
      await pg.query(
        `INSERT INTO agents (tenant_id, agent_id, agent_key, is_primary)
         VALUES ($1, $2, 'default', TRUE)`,
        [ids.tenantId, ids.agentId],
      );
      await pg.query(
        `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
         VALUES ($1, $2, 'default')`,
        [ids.tenantId, ids.workspaceId],
      );
      await pg.query(
        `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
         VALUES ($1, $2, $3)`,
        [ids.tenantId, ids.agentId, ids.workspaceId],
      );
      await pg.query(
        `INSERT INTO channel_accounts (
           tenant_id,
           workspace_id,
           channel_account_id,
           connector_key,
           account_key
         ) VALUES ($1, $2, $3, 'ui', 'default')`,
        [ids.tenantId, ids.workspaceId, ids.channelAccountId],
      );
      await pg.query(
        `INSERT INTO channel_threads (
           tenant_id,
           workspace_id,
           channel_thread_id,
           channel_account_id,
           provider_thread_id,
           container_kind
         ) VALUES ($1, $2, $3, $4, 'thread-1', 'channel')`,
        [ids.tenantId, ids.workspaceId, ids.channelThreadId, ids.channelAccountId],
      );
      await pg.query(
        `INSERT INTO conversations (
           tenant_id,
           conversation_id,
           conversation_key,
           agent_id,
           workspace_id,
           channel_thread_id,
           title,
           created_at,
           updated_at,
           context_state_json,
           messages_json
         ) VALUES (
           $1,
           $2,
           'agent:default:ui:default:channel:thread-1',
           $3,
           $4,
           $5,
           'Legacy conversation',
           '2026-03-19T09:00:00.000Z',
           '2026-03-19T09:00:00.000Z',
           '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":""}'::jsonb,
           '{"malformed":'
         )`,
        [ids.tenantId, ids.conversationId, ids.agentId, ids.workspaceId, ids.channelThreadId],
      );

      await applyPostgresMigration(
        pg,
        readFileSync(join(cutoverDir, migrationFile), "utf8"),
        migrationFile,
      );

      const conversation = await pg.query<{
        conversation_key: string;
      }>(
        `SELECT conversation_key
         FROM conversations
         WHERE tenant_id = $1 AND conversation_id = $2`,
        [ids.tenantId, ids.conversationId],
      );
      expect(conversation.rows[0]?.conversation_key).toBe(
        "agent:default:ui:default:channel:thread-1",
      );

      const state = await pg.query<{
        updated_at: string | Date;
        summary_json: unknown;
        pending_json: unknown;
      }>(
        `SELECT
           updated_at,
           summary_json,
           pending_json
         FROM conversation_state
         WHERE tenant_id = $1 AND conversation_id = $2`,
        [ids.tenantId, ids.conversationId],
      );
      expect(new Date(state.rows[0]!.updated_at).toISOString()).toBe("2026-03-19T09:00:00.000Z");
      expect(state.rows[0]?.summary_json).toBeNull();
      expect(state.rows[0]?.pending_json).toEqual({
        compacted_through_message_id: null,
        recent_message_ids: [],
        pending_approvals: [],
        pending_tool_state: [],
      });

      const transcript = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM transcript_events
         WHERE tenant_id = $1 AND conversation_id = $2`,
        [ids.tenantId, ids.conversationId],
      );
      expect(Number(transcript.rows[0]?.count ?? "0")).toBe(0);
    } finally {
      await pg.end();
      rmSync(pre153Dir, { recursive: true, force: true });
      rmSync(cutoverDir, { recursive: true, force: true });
    }
  });
});
