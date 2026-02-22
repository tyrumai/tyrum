import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { SqlDb, RunResult } from "../../src/statestore/types.js";
import { pruneByAge, pruneByCount } from "../../src/modules/retention/dal.js";

type PgClient = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
};

function translatePlaceholders(sql: string): string {
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

  return out;
}

function wrapPgClient(client: PgClient): SqlDb {
  const wrapped: SqlDb = {
    kind: "postgres",
    async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
      const res = await client.query(translatePlaceholders(sql), params as unknown[]);
      return (res.rows[0] as T | undefined) ?? undefined;
    },
    async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await client.query(translatePlaceholders(sql), params as unknown[]);
      return res.rows as T[];
    },
    async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
      const res = await client.query(translatePlaceholders(sql), params as unknown[]);
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
    async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
      await client.query("BEGIN");
      try {
        const result = await fn(wrapped);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }
    },
    async close(): Promise<void> {
      await client.end();
    },
  };
  return wrapped;
}

describe("Retention DAL (postgres)", () => {
  let client: PgClient | undefined;
  let db: SqlDb | undefined;

  beforeEach(async () => {
    const mem = newDb();
    const { Client } = mem.adapters.createPg();
    client = new Client();
    await client.connect();
    db = wrapPgClient(client);

    await db.exec(`
      CREATE TABLE retention_events (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
    client = undefined;
  });

  it("pruneByAge deletes rows older than cutoff", async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    await db!.run("INSERT INTO retention_events (created_at, payload) VALUES (?, ?)", [old, "old"]);
    await db!.run("INSERT INTO retention_events (created_at, payload) VALUES (?, ?)", [recent, "recent"]);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const deleted = await pruneByAge(db!, "retention_events", "id", "created_at", cutoff);

    expect(deleted).toBe(1);

    const remaining = await db!.all<{ payload: string }>(
      "SELECT payload FROM retention_events ORDER BY created_at ASC",
    );
    expect(remaining).toEqual([{ payload: "recent" }]);
  });

  it("pruneByCount deletes excess rows keeping most recent", async () => {
    for (let i = 0; i < 5; i += 1) {
      const ts = new Date(Date.now() - (5 - i) * 1000).toISOString();
      await db!.run("INSERT INTO retention_events (created_at, payload) VALUES (?, ?)", [ts, `evt-${i}`]);
    }

    const deleted = await pruneByCount(db!, "retention_events", "id", 2, "created_at");
    expect(deleted).toBe(3);

    const remaining = await db!.all<{ payload: string }>(
      "SELECT payload FROM retention_events ORDER BY created_at ASC",
    );
    expect(remaining.map((r) => r.payload)).toEqual(["evt-3", "evt-4"]);
  });
});
