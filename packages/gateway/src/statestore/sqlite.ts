import type Database from "better-sqlite3";
import { createDatabase } from "../db.js";
import { migrate } from "../migrate.js";
import type { SqlDb, RunResult } from "./types.js";

export class SqliteDb implements SqlDb {
  readonly kind = "sqlite" as const;
  private readonly db: Database.Database;
  private transactionDepth = 0;

  constructor(db: Database.Database) {
    this.db = db;
  }

  static open(opts: { dbPath: string; migrationsDir: string }): SqliteDb {
    const db = createDatabase(opts.dbPath);
    migrate(db, opts.migrationsDir);
    return new SqliteDb(db);
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const res = this.db.prepare(sql).run(...params);
    return { changes: res.changes };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    const isOuter = this.transactionDepth === 0;
    const savepoint = isOuter ? undefined : `tyrum_sp_${this.transactionDepth + 1}`;

    if (isOuter) {
      this.db.exec("BEGIN");
    } else {
      this.db.exec(`SAVEPOINT ${savepoint}`);
    }

    this.transactionDepth += 1;
    try {
      const result = await fn(this);
      if (isOuter) {
        this.db.exec("COMMIT");
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return result;
    } catch (err) {
      try {
        if (isOuter) {
          this.db.exec("ROLLBACK");
        } else {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
      } catch {
        // ignore
      }
      throw err;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

