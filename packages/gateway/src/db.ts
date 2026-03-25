import Database from "better-sqlite3";
import { resolveBetterSqliteNativeBindingPath } from "./better-sqlite-native-binding.js";

export function createDatabase(path: string): Database.Database {
  const nativeBinding = resolveBetterSqliteNativeBindingPath();
  const db = new Database(path, nativeBinding ? { nativeBinding } : undefined);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
