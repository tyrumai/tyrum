import { describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import type { AgentConfig } from "@tyrum/schemas";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Memory v1 consolidation pipeline", () => {
  it("returns under budget via dedupe + episodic consolidation (no eviction)", async () => {
    const db = openTestSqliteDb();
    const dal = new MemoryV1Dal(db);
    const vectorDal = new VectorDal(db);

    try {
      const tenantId = DEFAULT_TENANT_ID;
      const agentId = DEFAULT_AGENT_ID;

      const factLow = await dal.create(
        {
          kind: "fact",
          key: "favorite_color",
          value: "blue",
          observed_at: "2026-02-01T00:00:00.000Z",
          confidence: 0.4,
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        agentId,
      );

      const factHigh = await dal.create(
        {
          kind: "fact",
          key: "favorite_color",
          value: "green",
          observed_at: "2026-02-02T00:00:00.000Z",
          confidence: 0.9,
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        agentId,
      );

      const note = await dal.create(
        {
          kind: "note",
          title: "On-call notes",
          body_md: "Remember to check dashboards.",
          tags: ["ops"],
          sensitivity: "private",
          provenance: { source_kind: "operator", refs: [] },
        },
        agentId,
      );

      const e1 = await dal.create(
        {
          kind: "episode",
          occurred_at: "2026-02-01T10:00:00.000Z",
          summary_md: "Investigated alert A. Restart fixed it.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "system", refs: [] },
        },
        agentId,
      );
      const e2 = await dal.create(
        {
          kind: "episode",
          occurred_at: "2026-02-02T10:00:00.000Z",
          summary_md: "Investigated alert B. Rolled back deployment.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "system", refs: [] },
        },
        agentId,
      );
      const e3 = await dal.create(
        {
          kind: "episode",
          occurred_at: "2026-02-03T10:00:00.000Z",
          summary_md: "Investigated alert C. Adjusted thresholds.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "system", refs: [] },
        },
        agentId,
      );

      const embeddingId = await vectorDal.insertEmbedding(
        `memory_item:${note.memory_item_id}`,
        [1, 0, 0, 0],
        "test-embedder",
        { memory_item_id: note.memory_item_id, kind: note.kind },
        { tenantId, agentId },
      );
      await db.run(
        `INSERT INTO memory_item_embeddings (
           tenant_id,
           agent_id,
           memory_item_id,
           embedding_id,
           embedding_model,
           vector_data
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          agentId,
          note.memory_item_id,
          embeddingId,
          "test-embedder",
          JSON.stringify([1, 0, 0, 0]),
        ],
      );

      const budgets: AgentConfig["memory"]["v1"]["budgets"] = {
        max_total_items: 3,
        max_total_chars: 50_000,
        per_kind: {
          fact: { max_items: 3, max_chars: 20_000 },
          note: { max_items: 5, max_chars: 20_000 },
          procedure: { max_items: 3, max_chars: 20_000 },
          episode: { max_items: 10, max_chars: 20_000 },
        },
      };

      await dal.consolidateToBudgets({ budgets, agentId });

      const { items } = await dal.list({ agentId, limit: 50 });
      expect(items.length).toBeLessThanOrEqual(3);

      const facts = items.filter((i) => i.kind === "fact");
      expect(facts).toHaveLength(1);
      expect((facts[0] as { key?: string }).key).toBe("favorite_color");
      expect((facts[0] as { value?: unknown }).value).toBe("green");

      const episodes = items.filter((i) => i.kind === "episode");
      expect(episodes).toHaveLength(0);

      const notes = items.filter((i) => i.kind === "note");
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.some((n) => (n as { title?: string }).title?.includes("Episodic"))).toBe(true);

      const tombstones = await dal.listTombstones({ agentId, limit: 50 });
      expect(tombstones.tombstones.length).toBeGreaterThanOrEqual(4);
      expect(tombstones.tombstones.every((t) => t.deleted_by === "consolidation")).toBe(true);

      const embeddingLinks = await db.get<{ c: number }>(
        `SELECT COUNT(*) AS c
         FROM memory_item_embeddings
         WHERE tenant_id = ?
           AND agent_id = ?`,
        [tenantId, agentId],
      );
      expect(Number(embeddingLinks?.c ?? 0)).toBe(1);

      const memoryVectors = await db.get<{ c: number }>(
        `SELECT COUNT(*) AS c
         FROM vector_metadata
         WHERE tenant_id = ?
           AND agent_id = ?
           AND label LIKE ?`,
        [tenantId, agentId, "memory_item:%"],
      );
      expect(Number(memoryVectors?.c ?? 0)).toBe(1);

      expect([factLow.memory_item_id, factHigh.memory_item_id]).toContain(facts[0]?.memory_item_id);
      expect([e1.memory_item_id, e2.memory_item_id, e3.memory_item_id]).not.toContain(
        facts[0]?.memory_item_id,
      );
    } finally {
      await db.close();
    }
  });

  it("evicts least-recently-updated notes under budget pressure and drops derived indexes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00.000Z"));

    const db = openTestSqliteDb();
    const dal = new MemoryV1Dal(db);
    const vectorDal = new VectorDal(db);

    try {
      const tenantId = DEFAULT_TENANT_ID;
      const agentId = DEFAULT_AGENT_ID;

      const oldNote = await dal.create(
        {
          kind: "note",
          title: "Old",
          body_md: "Old body",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "operator", refs: [] },
        },
        agentId,
      );

      const newNote = await dal.create(
        {
          kind: "note",
          title: "New",
          body_md: "New body",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "operator", refs: [] },
        },
        agentId,
      );

      vi.setSystemTime(new Date("2026-02-19T12:00:01.000Z"));
      await dal.update(newNote.memory_item_id, { body_md: "New body (updated)" }, agentId);

      const embeddingId = await vectorDal.insertEmbedding(
        `memory_item:${newNote.memory_item_id}`,
        [1, 0, 0, 0],
        "test-embedder",
        { memory_item_id: newNote.memory_item_id, kind: newNote.kind },
        { tenantId, agentId },
      );
      await db.run(
        `INSERT INTO memory_item_embeddings (
           tenant_id,
           agent_id,
           memory_item_id,
           embedding_id,
           embedding_model,
           vector_data
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          agentId,
          newNote.memory_item_id,
          embeddingId,
          "test-embedder",
          JSON.stringify([1, 0, 0, 0]),
        ],
      );

      const budgets: AgentConfig["memory"]["v1"]["budgets"] = {
        max_total_items: 1,
        max_total_chars: 50_000,
        per_kind: {
          fact: { max_items: 3, max_chars: 20_000 },
          note: { max_items: 1, max_chars: 20_000 },
          procedure: { max_items: 3, max_chars: 20_000 },
          episode: { max_items: 3, max_chars: 20_000 },
        },
      };

      await dal.consolidateToBudgets({ budgets, agentId });

      const { items } = await dal.list({ agentId, limit: 50 });
      expect(items).toHaveLength(1);
      expect(items[0]?.kind).toBe("note");
      expect(items[0]?.memory_item_id).toBe(newNote.memory_item_id);

      const tombstones = await dal.listTombstones({ agentId, limit: 50 });
      expect(tombstones.tombstones.some((t) => t.deleted_by === "budget")).toBe(true);
      expect(tombstones.tombstones.some((t) => t.memory_item_id === oldNote.memory_item_id)).toBe(
        true,
      );

      const embeddingLinks = await db.get<{ c: number }>(
        `SELECT COUNT(*) AS c
         FROM memory_item_embeddings
         WHERE tenant_id = ?
           AND agent_id = ?`,
        [tenantId, agentId],
      );
      expect(Number(embeddingLinks?.c ?? 0)).toBe(0);

      const memoryVectors = await db.get<{ c: number }>(
        `SELECT COUNT(*) AS c
         FROM vector_metadata
         WHERE tenant_id = ?
           AND agent_id = ?
           AND label LIKE ?`,
        [tenantId, agentId, "memory_item:%"],
      );
      expect(Number(memoryVectors?.c ?? 0)).toBe(0);
    } finally {
      vi.useRealTimers();
      await db.close();
    }
  });
});
