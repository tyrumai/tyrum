import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { newDb } from "pg-mem";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type OpenDalResult = { dal: MemoryV1Dal; close: () => Promise<void> };

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

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

async function openPgMemDal(): Promise<OpenDalResult> {
  const mem = newDb();
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
    dal: new MemoryV1Dal(db),
    close: async () => {
      await pg.end();
    },
  };
}

async function openSqliteDal(): Promise<OpenDalResult> {
  const db = openTestSqliteDb();
  return {
    dal: new MemoryV1Dal(db),
    close: async () => {
      await db.close();
    },
  };
}

const fixtures = [
  { name: "sqlite" as const, open: openSqliteDal },
  { name: "postgres" as const, open: openPgMemDal },
];

for (const fixture of fixtures) {
  describe(`MemoryV1Dal (${fixture.name})`, () => {
    it("creates, reads, updates, and deletes with a tombstone", async () => {
      const { dal, close } = await fixture.open();
      try {
        const observedAt = "2026-02-19T12:00:00Z";

        const created = await dal.create(
          {
            kind: "fact",
            key: "favorite_color",
            value: "blue",
            observed_at: observedAt,
            confidence: 0.9,
            tags: ["project", "prefs"],
            sensitivity: "private",
            provenance: {
              source_kind: "user",
              channel: "telegram",
              thread_id: "123",
              session_id: "agent:default:main",
              refs: ["msg:1"],
              metadata: { lang: "en" },
            },
          },
          "agent-a",
        );

        expect(created.v).toBe(1);
        expect(created.kind).toBe("fact");
        expect(created.agent_id).toBe("agent-a");
        expect(created.tags.sort()).toEqual(["prefs", "project"]);
        expect(created.created_at).toBeTruthy();
        expect(created.updated_at).toBeUndefined();
        expect(created.provenance.source_kind).toBe("user");
        expect(created.provenance.channel).toBe("telegram");
        expect(created.provenance.refs).toEqual(["msg:1"]);
        expect(created.key).toBe("favorite_color");
        expect(created.value).toBe("blue");
        expect(created.observed_at).toBe(observedAt);
        expect(created.confidence).toBe(0.9);

        const fetched = await dal.getById(created.memory_item_id, "agent-a");
        expect(fetched).toEqual(created);

        const updated = await dal.update(
          created.memory_item_id,
          { value: "green", confidence: 0.5, tags: ["prefs"] },
          "agent-a",
        );
        expect(updated.v).toBe(1);
        expect(updated.memory_item_id).toBe(created.memory_item_id);
        expect(updated.agent_id).toBe("agent-a");
        expect(updated.kind).toBe("fact");
        expect(updated.value).toBe("green");
        expect(updated.confidence).toBe(0.5);
        expect(updated.tags).toEqual(["prefs"]);
        expect(updated.updated_at).toBeTruthy();

        const tombstone = await dal.delete(
          created.memory_item_id,
          { deleted_by: "operator", reason: "user request" },
          "agent-a",
        );
        expect(tombstone.v).toBe(1);
        expect(tombstone.agent_id).toBe("agent-a");
        expect(tombstone.memory_item_id).toBe(created.memory_item_id);
        expect(tombstone.deleted_at).toBeTruthy();
        expect(tombstone.deleted_by).toBe("operator");
        expect(tombstone.reason).toBe("user request");

        expect(await dal.getById(created.memory_item_id, "agent-a")).toBeUndefined();
        expect(await dal.getTombstoneById(created.memory_item_id, "agent-a")).toEqual(tombstone);
      } finally {
        await close();
      }
    });

    it("partitions all records by agent_id", async () => {
      const { dal, close } = await fixture.open();
      try {
        const created = await dal.create(
          {
            kind: "note",
            title: "On-call notes",
            body_md: "Remember to check dashboards.",
            tags: ["project"],
            sensitivity: "private",
            provenance: { source_kind: "operator", refs: [] },
          },
          "agent-a",
        );

        expect(await dal.getById(created.memory_item_id, "agent-b")).toBeUndefined();

        await dal.delete(created.memory_item_id, { deleted_by: "operator" }, "agent-a");
        expect(await dal.getTombstoneById(created.memory_item_id, "agent-b")).toBeUndefined();
      } finally {
        await close();
      }
    });

    it("rejects kind-incompatible patch fields", async () => {
      const { dal, close } = await fixture.open();
      try {
        const created = await dal.create(
          {
            kind: "fact",
            key: "favorite_color",
            value: "blue",
            observed_at: "2026-02-19T12:00:00Z",
            confidence: 0.9,
            tags: [],
            sensitivity: "private",
            provenance: { source_kind: "operator", refs: [] },
          },
          "agent-a",
        );

        await expect(
          dal.update(created.memory_item_id, { body_md: "should fail" }, "agent-a"),
        ).rejects.toThrow(/incompatible patch/i);
      } finally {
        await close();
      }
    });
  });
}
