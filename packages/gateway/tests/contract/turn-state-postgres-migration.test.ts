import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/157_turn_state_columns.sql"),
  "utf8",
);

describe("turn state postgres migration", () => {
  it("adds lease, checkpoint, and progress columns to turns", () => {
    const mem = newDb();

    mem.public.none(`
      CREATE TABLE turns (
        tenant_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tenant_id, turn_id)
      );

      INSERT INTO turns (
        tenant_id,
        turn_id,
        job_id,
        conversation_key,
        status,
        attempt,
        created_at
      ) VALUES (
        'tenant-1',
        'turn-1',
        'job-1',
        'agent:default:main',
        'queued',
        1,
        '2026-03-31T14:00:00.000Z'
      );
    `);

    expect(() => mem.public.none(migrationSql)).not.toThrow();

    const row = mem.public.one<{
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
      checkpoint_json: string | null;
      last_progress_at: Date | null;
      last_progress_json: string | null;
    }>(
      `SELECT
         lease_owner,
         lease_expires_at_ms,
         checkpoint_json,
         last_progress_at,
         last_progress_json
       FROM turns
       WHERE tenant_id = 'tenant-1' AND turn_id = 'turn-1'`,
    );
    expect(row.lease_owner).toBeNull();
    expect(row.lease_expires_at_ms).toBeNull();
    expect(row.checkpoint_json).toBeNull();
    expect(row.last_progress_at).toBeNull();
    expect(row.last_progress_json).toBeNull();

    expect(() =>
      mem.public.none(
        `UPDATE turns
         SET lease_owner = 'worker-1',
             lease_expires_at_ms = 123,
             checkpoint_json = '{"cursor":"m-1"}',
             last_progress_at = '2026-03-31T14:00:05.000Z',
             last_progress_json = '{"kind":"claimed"}'
         WHERE tenant_id = 'tenant-1' AND turn_id = 'turn-1'`,
      ),
    ).not.toThrow();
  });
});
