import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("VectorDal", () => {
  let db: SqliteDb;
  let dal: VectorDal;
  const agentId = "default";

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new VectorDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("insertEmbedding", () => {
    it("stores and retrieves an embedding", async () => {
      const id = await dal.insertEmbedding(agentId, "test-label", [1, 0, 0], "text-embedding-3");
      expect(id).toBeTruthy();

      const row = await dal.getById(agentId, id);
      expect(row).toBeDefined();
      expect(row!.label).toBe("test-label");
      expect(row!.vector).toEqual([1, 0, 0]);
      expect(row!.embedding_model).toBe("text-embedding-3");
    });

    it("stores metadata", async () => {
      const id = await dal.insertEmbedding(agentId, "with-meta", [0.5, 0.5], "model", { source: "test" });
      const row = await dal.getById(agentId, id);
      const meta = row!.metadata as Record<string, unknown>;
      expect(meta.source).toBe("test");
    });

    it("generates unique embedding_id", async () => {
      const id1 = await dal.insertEmbedding(agentId, "a", [1], "model");
      const id2 = await dal.insertEmbedding(agentId, "b", [2], "model");
      expect(id1).not.toBe(id2);
    });
  });

  describe("searchByCosineSimilarity", () => {
    it("returns most similar vectors first", async () => {
      await dal.insertEmbedding(agentId, "north", [1, 0, 0], "model");
      await dal.insertEmbedding(agentId, "northeast", [0.7, 0.7, 0], "model");
      await dal.insertEmbedding(agentId, "east", [0, 1, 0], "model");

      const results = await dal.searchByCosineSimilarity(agentId, [1, 0, 0], 3);
      expect(results).toHaveLength(3);

      expect(results[0].row.label).toBe("north");
      expect(results[0].similarity).toBeCloseTo(1.0, 5);

      expect(results[1].row.label).toBe("northeast");
      expect(results[1].similarity).toBeGreaterThan(0.5);

      expect(results[2].row.label).toBe("east");
      expect(results[2].similarity).toBeCloseTo(0.0, 5);
    });

    it("respects topK limit", async () => {
      await dal.insertEmbedding(agentId, "a", [1, 0], "model");
      await dal.insertEmbedding(agentId, "b", [0, 1], "model");
      await dal.insertEmbedding(agentId, "c", [0.5, 0.5], "model");

      const results = await dal.searchByCosineSimilarity(agentId, [1, 0], 2);
      expect(results).toHaveLength(2);
    });

    it("returns empty for no embeddings", async () => {
      const results = await dal.searchByCosineSimilarity(agentId, [1, 0, 0], 5);
      expect(results).toHaveLength(0);
    });

    it("handles orthogonal vectors (similarity ~0)", async () => {
      await dal.insertEmbedding(agentId, "x-axis", [1, 0, 0], "model");
      const results = await dal.searchByCosineSimilarity(agentId, [0, 1, 0], 1);
      expect(results[0].similarity).toBeCloseTo(0.0, 5);
    });

    it("handles identical vectors (similarity 1.0)", async () => {
      await dal.insertEmbedding(agentId, "match", [0.3, 0.4, 0.5], "model");
      const results = await dal.searchByCosineSimilarity(agentId, [0.3, 0.4, 0.5], 1);
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });

    it("handles opposite vectors (similarity -1.0)", async () => {
      await dal.insertEmbedding(agentId, "opposite", [1, 0], "model");
      const results = await dal.searchByCosineSimilarity(agentId, [-1, 0], 1);
      expect(results[0].similarity).toBeCloseTo(-1.0, 5);
    });
  });

  describe("deleteByLabel", () => {
    it("removes embeddings by label", async () => {
      await dal.insertEmbedding(agentId, "to-delete", [1, 0], "model");
      await dal.insertEmbedding(agentId, "to-keep", [0, 1], "model");

      const count = await dal.deleteByLabel(agentId, "to-delete");
      expect(count).toBe(1);

      const remaining = await dal.list(agentId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe("to-keep");
    });

    it("returns 0 for non-existent label", async () => {
      const count = await dal.deleteByLabel(agentId, "nonexistent");
      expect(count).toBe(0);
    });

    it("deletes all rows with same label", async () => {
      // Insert two with same label (different embedding_ids)
      await dal.insertEmbedding(agentId, "duplicate", [1, 0], "model");
      await dal.insertEmbedding(agentId, "duplicate", [0, 1], "model");

      const count = await dal.deleteByLabel(agentId, "duplicate");
      expect(count).toBe(2);
    });
  });

  describe("list", () => {
    it("lists embeddings ordered by creation time descending", async () => {
      await dal.insertEmbedding(agentId, "first", [1], "model");
      await dal.insertEmbedding(agentId, "second", [2], "model");

      const items = await dal.list(agentId);
      expect(items).toHaveLength(2);
      expect(items[0].label).toBe("second");
      expect(items[1].label).toBe("first");
    });

    it("returns empty when no embeddings exist", async () => {
      const items = await dal.list(agentId);
      expect(items).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("returns undefined for unknown id", async () => {
      const result = await dal.getById(agentId, "nonexistent-uuid");
      expect(result).toBeUndefined();
    });
  });
});
