import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { MemoryV1SemanticIndex } from "../../src/modules/memory/v1-semantic-index.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { newDb } from "pg-mem";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type OpenDbResult = { dal: MemoryV1Dal; db: SqlDb; close: () => Promise<void> };

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

async function openPgMemDb(): Promise<OpenDbResult> {
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
    db,
    close: async () => {
      await pg.end();
    },
  };
}

async function openSqliteDb(): Promise<OpenDbResult> {
  const db = openTestSqliteDb();
  return {
    dal: new MemoryV1Dal(db),
    db,
    close: async () => {
      await db.close();
    },
  };
}

const EMBED_FEATURES = ["pizza", "pasta", "hiking", "mountains", "ssn"] as const;

function embedDeterministic(text: string): number[] {
  const haystack = text.toLowerCase();
  return EMBED_FEATURES.map((feature) => (haystack.includes(feature) ? 1 : 0));
}

const fixtures = [
  { name: "sqlite" as const, open: openSqliteDb },
  { name: "postgres" as const, open: openPgMemDb },
];

for (const fixture of fixtures) {
  describe(`MemoryV1 semantic index (${fixture.name})`, () => {
    it("rebuilds, searches, drops, and rebuilds again without losing canonical content", async () => {
      const { dal, db, close } = await fixture.open();
      try {
        const index = new MemoryV1SemanticIndex({
          db,
          agentId: "agent-a",
          embedder: {
            modelId: "test/deterministic-v1",
            embed: async (t: string) => embedDeterministic(t),
          },
        });

        const note = await dal.create(
          {
            kind: "note",
            title: "Food prefs",
            body_md: "I like pizza and pasta.",
            tags: ["prefs"],
            sensitivity: "private",
            provenance: { source_kind: "user", refs: [] },
          },
          "agent-a",
        );

        const _other = await dal.create(
          {
            kind: "note",
            title: "Hobbies",
            body_md: "I enjoy hiking in the mountains.",
            tags: ["prefs"],
            sensitivity: "private",
            provenance: { source_kind: "user", refs: [] },
          },
          "agent-a",
        );

        const sensitive = await dal.create(
          {
            kind: "note",
            title: "Sensitive",
            body_md: "My SSN is 000-00-0000.",
            tags: ["sensitive"],
            sensitivity: "sensitive",
            provenance: { source_kind: "operator", refs: [] },
          },
          "agent-a",
        );

        await index.rebuild();

        const hits = await index.search("pizza", 5);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]?.memory_item_id).toBe(note.memory_item_id);
        expect(hits[0]?.kind).toBe("note");
        expect(hits[0]?.score).toBeGreaterThan(0);
        expect(hits.some((h) => h.memory_item_id === sensitive.memory_item_id)).toBe(false);

        await index.drop();

        const afterDrop = await index.search("pizza", 5);
        expect(afterDrop).toEqual([]);

        // Canonical content still present after dropping derived index rows.
        expect(await dal.getById(note.memory_item_id, "agent-a")).toBeTruthy();

        await index.rebuild();
        const afterRebuild = await index.search("pizza", 5);
        expect(afterRebuild[0]?.memory_item_id).toBe(note.memory_item_id);

        // Unrelated agent is isolated.
        const otherAgentIndex = new MemoryV1SemanticIndex({
          db,
          agentId: "agent-b",
          embedder: {
            modelId: "test/deterministic-v1",
            embed: async (t: string) => embedDeterministic(t),
          },
        });
        await otherAgentIndex.rebuild();
        expect(await otherAgentIndex.search("pizza", 5)).toEqual([]);
      } finally {
        await close();
      }
    });
  });
}
