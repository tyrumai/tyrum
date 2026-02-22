import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function safeSqliteIdentifier(value: string): string {
  // Identifiers are not parameterizable; enforce a strict allowlist to avoid SQL injection.
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`invalid sqlite identifier: '${value}'`);
  }
  return value;
}

function getSqliteTableColumns(db: Database.Database, table: string): ReadonlySet<string> {
  const safeTable = safeSqliteIdentifier(table);
  const rows = db.prepare(`PRAGMA table_info(${safeTable})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function patchSqliteMigrationSql(
  db: Database.Database,
  file: string,
  sql: string,
): string {
  // SQLite migration 006 historically ran against sessions schemas both with and without
  // session compaction columns. Strip copy lines if the source table lacks them.
  if (file !== "006_sessions_agent_id.sql") return sql;

  const columns = getSqliteTableColumns(db, "sessions");
  const missing: string[] = [];
  if (!columns.has("compacted_summary")) missing.push("compacted_summary");
  if (!columns.has("compaction_count")) missing.push("compaction_count");
  if (missing.length === 0) return sql;

  const strip = new Set<string>();
  for (const col of missing) {
    strip.add(col);
    strip.add(`${col},`);
  }

  return sql
    .split(/\r?\n/)
    .filter((line) => !strip.has(line.trim()))
    .join("\n");
}

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
    const rawSql = readFileSync(join(migrationsDir, file), "utf-8");
    const sql = patchSqliteMigrationSql(db, file, rawSql);
    applyMigration(file, sql);
    applied.add(file);
  }
}
