import pg from "pg";
import type { ClientBase } from "pg";
import { migratePostgres } from "../migrate-postgres.js";
import type { SqlDb, RunResult } from "./types.js";

const { Pool, types } = pg;

type Queryable = Pick<ClientBase, "query">;

function translatePlaceholders(sql: string): { sql: string; count: number } {
  let out = "";
  let count = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;

    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle) {
        const next = sql[i + 1];
        if (next === "'") {
          out += next;
          i += 1;
        } else {
          inSingle = false;
        }
      } else {
        inSingle = true;
      }
      continue;
    }

    if (ch === `"` && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (ch === "?" && !inSingle && !inDouble) {
      count += 1;
      out += `$${count}`;
      continue;
    }

    out += ch;
  }

  return { sql: out, count };
}

function applyPostgresTypeParsers(): void {
  // OID 20 = INT8 / BIGINT. Many of our IDs and lease times are BIGINT in Postgres.
  // We parse to number to match schema expectations (safe as long as values stay <= 2^53-1).
  types.setTypeParser(20, (val: string) => Number(val));
}

export class PostgresDb implements SqlDb {
  readonly kind = "postgres" as const;

  private readonly pool?: InstanceType<typeof Pool>;
  private readonly client: Queryable;

  private constructor(opts: { pool?: InstanceType<typeof Pool>; client: Queryable }) {
    this.pool = opts.pool;
    this.client = opts.client;
  }

  static async open(opts: { dbUri: string; migrationsDir: string }): Promise<PostgresDb> {
    applyPostgresTypeParsers();

    const pool = new Pool({ connectionString: opts.dbUri });
    const client = await pool.connect();
    try {
      await acquireMigrationLock(client);
      try {
        await migratePostgres(client, opts.migrationsDir);
      } finally {
        await releaseMigrationLock(client);
      }
    } finally {
      client.release();
    }
    return new PostgresDb({ pool, client: pool });
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const translated = translatePlaceholders(sql);
    const res = await this.client.query(translated.sql, params as unknown[]);
    return (res.rows[0] as T | undefined) ?? undefined;
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const translated = translatePlaceholders(sql);
    const res = await this.client.query(translated.sql, params as unknown[]);
    return res.rows as T[];
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const translated = translatePlaceholders(sql);
    const res = await this.client.query(translated.sql, params as unknown[]);
    return { changes: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    if (!this.pool) {
      await this.client.query("BEGIN");
      try {
        const result = await fn(this);
        await this.client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await this.client.query("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }
    }

    const client = await (this.pool as InstanceType<typeof Pool>).connect();
    try {
      await client.query("BEGIN");
      const tx = new PostgresDb({ client });
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

const MIGRATION_LOCK_KEY1 = 1959359839; // "tyru" as int-ish
const MIGRATION_LOCK_KEY2 = 1836016434; // "migr" as int-ish

async function acquireMigrationLock(client: ClientBase): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1, $2)", [
    MIGRATION_LOCK_KEY1,
    MIGRATION_LOCK_KEY2,
  ]);
}

async function releaseMigrationLock(client: ClientBase): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1, $2)", [
    MIGRATION_LOCK_KEY1,
    MIGRATION_LOCK_KEY2,
  ]);
}

