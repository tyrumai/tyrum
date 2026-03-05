import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDb } from "../../src/statestore/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SQLITE_MIGRATIONS_DIR = join(__dirname, "../../migrations/sqlite");

export function openTestSqliteDb(dbPath = ":memory:"): SqliteDb {
  try {
    return SqliteDb.open({ dbPath, migrationsDir: SQLITE_MIGRATIONS_DIR });
  } catch (err) {
    const rootMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      "Failed to open SQLite test database. " +
        "This can be caused by a failing native better-sqlite3 binding load or a migrations/SQL error. " +
        `Root cause: ${rootMessage}. ` +
        "Ensure you're using the repo's Node version and try re-installing dependencies (pnpm install) " +
        "or rebuilding the native module (pnpm -w rebuild better-sqlite3).",
      { cause: err },
    );
  }
}
