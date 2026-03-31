import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/157_turn_state_columns.sql"),
  "utf8",
);

describe("sqlite turn state migration", () => {
  it("adds lease, checkpoint, and progress columns to turns", () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE turns (
          tenant_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          status TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          created_at TEXT NOT NULL,
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

      expect(() => sqlite.exec(migrationSql)).not.toThrow();

      const row = sqlite
        .prepare(
          `SELECT
             lease_owner,
             lease_expires_at_ms,
             checkpoint_json,
             last_progress_at,
             last_progress_json
           FROM turns
           WHERE tenant_id = 'tenant-1' AND turn_id = 'turn-1'`,
        )
        .get() as {
        lease_owner: string | null;
        lease_expires_at_ms: number | null;
        checkpoint_json: string | null;
        last_progress_at: string | null;
        last_progress_json: string | null;
      };
      expect(row).toEqual({
        lease_owner: null,
        lease_expires_at_ms: null,
        checkpoint_json: null,
        last_progress_at: null,
        last_progress_json: null,
      });

      const indexes = sqlite.prepare(`PRAGMA index_list('turns')`).all() as Array<{ name: string }>;
      expect(indexes.some((index) => index.name === "turns_lease_expires_at_ms_idx")).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
