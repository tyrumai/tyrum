import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataType, newDb } from "pg-mem";
import { migratePostgres } from "../../src/migrate-postgres.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

function translatePlaceholders(sql: string): { sql: string; count: number } {
  let count = 0;
  let out = "";
  let inSingle = false;
  let inDouble = false;

  for (const ch of sql) {
    if (ch === `'` && !inDouble) {
      inSingle = !inSingle;
      out += ch;
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

async function openPgMemDb(): Promise<{ db: SqlDb; close: () => Promise<void> }> {
  const mem = newDb();

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

  const { Client } = mem.adapters.createPg();
  const pg = new Client();
  await pg.connect();
  await migratePostgres(pg, postgresMigrationsDir);

  const db: SqlDb = {
    kind: "postgres",
    get: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated.sql, params as unknown[]);
      return (res.rows[0] as unknown) ?? undefined;
    },
    all: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated.sql, params as unknown[]);
      return res.rows as unknown[];
    },
    run: async (sql, params = []) => {
      const translated = translatePlaceholders(sql);
      const res = await pg.query(translated.sql, params as unknown[]);
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

describe("SessionDal.list (postgres)", () => {
  it("treats malformed turns_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openPgMemDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal);
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run("UPDATE sessions SET turns_json = ? WHERE tenant_id = ? AND session_id = ?", [
        "{ not: json",
        s1.tenant_id,
        s1.session_id,
      ]);

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).sort()).toEqual(
        [s1.session_key, s2.session_key].sort(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.turns_count).toBe(0);
      expect(corrupted?.last_turn).toBeNull();
    } finally {
      await close();
    }
  });

  it("treats non-array turns_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openPgMemDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal);
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run("UPDATE sessions SET turns_json = ? WHERE tenant_id = ? AND session_id = ?", [
        "{}",
        s1.tenant_id,
        s1.session_id,
      ]);

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).sort()).toEqual(
        [s1.session_key, s2.session_key].sort(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.turns_count).toBe(0);
      expect(corrupted?.last_turn).toBeNull();
    } finally {
      await close();
    }
  });
});
