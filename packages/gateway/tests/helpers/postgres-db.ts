import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migratePostgres } from "../../src/migrate-postgres.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { createPgMemDb } from "./pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const POSTGRES_MIGRATIONS_DIR = join(__dirname, "../../migrations/postgres");

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

export async function openTestPostgresDb(): Promise<{ db: SqlDb; close: () => Promise<void> }> {
  const mem = createPgMemDb();

  const { Client } = mem.adapters.createPg();
  const pg = new Client();
  await pg.connect();
  await migratePostgres(pg, POSTGRES_MIGRATIONS_DIR);

  const db: SqlDb = {
    kind: "postgres",
    get: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated, params as unknown[]);
      return (res.rows[0] as unknown) ?? undefined;
    },
    all: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated, params as unknown[]);
      return res.rows as unknown[];
    },
    run: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated, params as unknown[]);
      return { changes: res.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await pg.query(sql);
    },
    transaction: async (fn) => {
      await pg.query("BEGIN");
      try {
        const result = await fn(db);
        await pg.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await pg.query("ROLLBACK");
        } catch {
          // ignore rollback errors; surface original failure
        }
        throw err;
      }
    },
    close: async () => {},
  };

  return {
    db,
    close: async () => {
      await pg.end();
    },
  };
}
