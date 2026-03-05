import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDb } from "../../src/statestore/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SQLITE_MIGRATIONS_DIR = join(__dirname, "../../migrations/sqlite");

export function openTestSqliteDb(dbPath = ":memory:"): SqliteDb {
  try {
    return SqliteDb.open({ dbPath, migrationsDir: SQLITE_MIGRATIONS_DIR });
  } catch (err) {
    throw new Error(
      "Failed to open SQLite test database. " +
        "This often means the native better-sqlite3 binding failed to load; " +
        "ensure you're using the repo's Node version and try re-installing dependencies (pnpm install) " +
        "or rebuilding the native module (pnpm -w rebuild better-sqlite3).",
      { cause: err },
    );
  }
}
