import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataType, newDb } from "pg-mem";
import { migratePostgres } from "../../src/migrate-postgres.js";
import type { SqlDb } from "../../src/statestore/types.js";

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

function registerCommonPgFunctions(mem: ReturnType<typeof newDb>): void {
  mem.public.registerFunction({
    name: "strpos",
    args: [DataType.text, DataType.text],
    returns: DataType.integer,
    implementation: (haystack: string, needle: string) => {
      const idx = haystack.indexOf(needle);
      return idx >= 0 ? idx + 1 : 0;
    },
  });

  mem.public.registerFunction({
    name: "jsonb_array_length",
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: (value: unknown) => {
      if (!Array.isArray(value)) {
        throw new Error("cannot get array length of a scalar/object");
      }
      return value.length;
    },
  });

  mem.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      if (typeof value === "object") return "object";
      if (typeof value === "string") return "string";
      if (typeof value === "number") return "number";
      if (typeof value === "boolean") return "boolean";
      return "unknown";
    },
  });

  mem.public.registerFunction({
    name: "pg_input_is_valid",
    args: [DataType.text, DataType.text],
    returns: DataType.bool,
    implementation: (value: string, targetType: string) => {
      if (!targetType || !targetType.toLowerCase().includes("json")) return false;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export async function openTestPostgresDb(): Promise<{ db: SqlDb; close: () => Promise<void> }> {
  const mem = newDb();
  registerCommonPgFunctions(mem);

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
