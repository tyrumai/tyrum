import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDb } from "../../src/statestore/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SQLITE_MIGRATIONS_DIR = join(__dirname, "../../migrations/sqlite");

export function openTestSqliteDb(dbPath = ":memory:"): SqliteDb {
  return SqliteDb.open({ dbPath, migrationsDir: SQLITE_MIGRATIONS_DIR });
}

