import type { ClientBase } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAppliedMigrationAlias } from "./migration-aliases.js";

/**
 * Applies SQL migration files in filename order from the given directory.
 * Tracks applied migrations in a `_migrations` table to ensure idempotency.
 */
export async function migratePostgres(client: ClientBase, migrationsDir: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const alias = findAppliedMigrationAlias(file, applied);
    if (alias) {
      await client.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [
        file,
      ]);
      applied.add(file);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.add(file);
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors; surface original failure
      }
      throw err;
    }
  }
}
