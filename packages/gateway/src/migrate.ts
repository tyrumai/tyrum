import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Applies SQL migration files in filename order from the given directory.
 * Tracks applied migrations in a `_migrations` table to ensure idempotency.
 *
 * Note: `db.exec()` below is better-sqlite3's Database.exec(), not
 * child_process.exec(). It runs SQL statements directly on the SQLite
 * connection with no shell involvement.
 */
export function migrate(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const insertMigration = db.prepare("INSERT INTO _migrations (name) VALUES (?)");
  const applyMigration = db.transaction((file: string, sql: string) => {
    // better-sqlite3 Database.exec() — runs SQL, not a shell command
    db.exec(sql);
    insertMigration.run(file);
  });

  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    applyMigration(file, sql);
    applied.add(file);
  }
}
