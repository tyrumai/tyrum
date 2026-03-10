import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { MemoryV1SemanticIndex } from "../../src/modules/memory/v1-semantic-index.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

type OpenDbResult = { dal: MemoryV1Dal; db: SqlDb; close: () => Promise<void> };

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

async function openPostgresDb(): Promise<OpenDbResult> {
  const { db, close } = await openTestPostgresDb();
  return { dal: new MemoryV1Dal(db), db, close };
}

const EMBED_FEATURES = [
  "pizza",
  "pasta",
  "hiking",
  "mountains",
  "ssn",
  "procedure",
  "episode",
] as const;

function embedDeterministic(text: string): number[] {
  const haystack = text.toLowerCase();
  return EMBED_FEATURES.map((feature) => (haystack.includes(feature) ? 1 : 0));
}

const fixtures = [
  { name: "sqlite" as const, open: openSqliteDb },
  { name: "postgres" as const, open: openPostgresDb },
];

for (const fixture of fixtures) {
  describe(`MemoryV1 semantic index (${fixture.name})`, () => {
    it("rebuilds, searches, drops, and rebuilds again without losing canonical content", async () => {
      const { dal, db, close } = await fixture.open();
      try {
        const scope = { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID };
        const index = new MemoryV1SemanticIndex({
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
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
          scope,
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
          scope,
        );

        const procedure = await dal.create(
          {
            kind: "procedure",
            title: "Pasta procedure",
            body_md: "Procedure: boil water, cook pasta, and drain.",
            tags: ["food"],
            sensitivity: "private",
            provenance: { source_kind: "operator", refs: [] },
          },
          scope,
        );

        const episode = await dal.create(
          {
            kind: "episode",
            occurred_at: "2026-02-20T00:00:00Z",
            summary_md: "Episode: cooked pasta successfully.",
            tags: ["food"],
            sensitivity: "private",
            provenance: { source_kind: "system", refs: [] },
          },
          scope,
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
          scope,
        );

        await index.rebuild();

        const hits = await index.search("pizza", 5);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]?.memory_item_id).toBe(note.memory_item_id);
        expect(hits[0]?.kind).toBe("note");
        expect(hits[0]?.score).toBeGreaterThan(0);
        expect(hits.some((h) => h.memory_item_id === sensitive.memory_item_id)).toBe(false);

        expect(await index.search("ssn", 5)).toEqual([]);

        const procedureHits = await index.search("procedure", 5);
        expect(procedureHits[0]?.memory_item_id).toBe(procedure.memory_item_id);
        expect(procedureHits[0]?.kind).toBe("procedure");

        const episodeHits = await index.search("episode", 5);
        expect(episodeHits[0]?.memory_item_id).toBe(episode.memory_item_id);
        expect(episodeHits[0]?.kind).toBe("episode");

        await index.drop();

        const afterDrop = await index.search("pizza", 5);
        expect(afterDrop).toEqual([]);

        // Canonical content still present after dropping derived index rows.
        expect(await dal.getById(note.memory_item_id, scope)).toBeTruthy();

        await index.rebuild();
        const afterRebuild = await index.search("pizza", 5);
        expect(afterRebuild[0]?.memory_item_id).toBe(note.memory_item_id);

        // Unrelated agent is isolated.
        const otherAgentIndex = new MemoryV1SemanticIndex({
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: "00000000-0000-4000-8000-0000000000b0",
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

    it("rebuilds stale embeddings when canonical memory is updated", async () => {
      const { dal, db, close } = await fixture.open();
      try {
        const scope = { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID };
        const index = new MemoryV1SemanticIndex({
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          embedder: {
            modelId: "test/deterministic-v1",
            embed: async (text: string) => embedDeterministic(text),
          },
        });

        const note = await dal.create(
          {
            kind: "note",
            title: "Food prefs",
            body_md: "I like pizza.",
            tags: ["prefs"],
            sensitivity: "private",
            provenance: { source_kind: "user", refs: [] },
          },
          scope,
        );

        await index.rebuild();
        expect(await index.hasStaleItems()).toBe(false);

        await dal.update(
          note.memory_item_id,
          {
            body_md: "I like hiking in the mountains.",
          },
          scope,
        );

        expect(await index.hasStaleItems()).toBe(true);
        const refreshed = await index.ensureFresh();
        expect(refreshed.rebuilt).toBe(true);

        const hits = await index.search("mountains", 5);
        expect(hits[0]?.memory_item_id).toBe(note.memory_item_id);
        expect(await index.hasStaleItems()).toBe(false);
      } finally {
        await close();
      }
    });
  });
}
