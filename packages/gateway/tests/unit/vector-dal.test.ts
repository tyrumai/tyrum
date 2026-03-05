import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";

describe("VectorDal", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let dal: VectorDal;
  const defaultScope = { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID };

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    dal = new VectorDal(db);
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  describe("insertEmbedding", () => {
    it("rejects inserts when scope is missing", async () => {
      await expect(
        dal.insertEmbedding("test-label", [1, 0, 0], "text-embedding-3"),
      ).rejects.toThrow();
    });

    it("stores and retrieves an embedding", async () => {
      const id = await dal.insertEmbedding(
        "test-label",
        [1, 0, 0],
        "text-embedding-3",
        undefined,
        defaultScope,
      );
      expect(id).toBeTruthy();

      const row = await dal.getById(id, defaultScope);
      expect(row).toBeDefined();
      expect(row!.label).toBe("test-label");
      expect(row!.vector).toEqual([1, 0, 0]);
      expect(row!.embedding_model).toBe("text-embedding-3");
    });

    it("stores metadata", async () => {
      const id = await dal.insertEmbedding(
        "with-meta",
        [0.5, 0.5],
        "model",
        { source: "test" },
        defaultScope,
      );
      const row = await dal.getById(id, defaultScope);
      const meta = row!.metadata as Record<string, unknown>;
      expect(meta.source).toBe("test");
    });

    it("generates unique embedding_id", async () => {
      const id1 = await dal.insertEmbedding("a", [1], "model", undefined, defaultScope);
      const id2 = await dal.insertEmbedding("b", [2], "model", undefined, defaultScope);
      expect(id1).not.toBe(id2);
    });

    it("does not mix tenant scopes", async () => {
      const identityScopeDal = new IdentityScopeDal(db);
      const otherScopeIds = await identityScopeDal.resolveScopeIds({ tenantKey: "tenant-b" });
      const otherScope = { tenantId: otherScopeIds.tenantId, agentId: otherScopeIds.agentId };

      await dal.insertEmbedding("default-tenant", [1, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("other-tenant", [0, 1], "model", undefined, otherScope);

      const defaultResults = await dal.searchByCosineSimilarity([0, 1], 10, defaultScope);
      expect(defaultResults.map((r) => r.row.label)).toEqual(["default-tenant"]);
    });
  });

  describe("searchByCosineSimilarity", () => {
    it("returns most similar vectors first", async () => {
      await dal.insertEmbedding("north", [1, 0, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("northeast", [0.7, 0.7, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("east", [0, 1, 0], "model", undefined, defaultScope);

      const results = await dal.searchByCosineSimilarity([1, 0, 0], 3, defaultScope);
      expect(results).toHaveLength(3);

      expect(results[0].row.label).toBe("north");
      expect(results[0].similarity).toBeCloseTo(1.0, 5);

      expect(results[1].row.label).toBe("northeast");
      expect(results[1].similarity).toBeGreaterThan(0.5);

      expect(results[2].row.label).toBe("east");
      expect(results[2].similarity).toBeCloseTo(0.0, 5);
    });

    it("respects topK limit", async () => {
      await dal.insertEmbedding("a", [1, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("b", [0, 1], "model", undefined, defaultScope);
      await dal.insertEmbedding("c", [0.5, 0.5], "model", undefined, defaultScope);

      const results = await dal.searchByCosineSimilarity([1, 0], 2, defaultScope);
      expect(results).toHaveLength(2);
    });

    it("returns empty for no embeddings", async () => {
      const results = await dal.searchByCosineSimilarity([1, 0, 0], 5, defaultScope);
      expect(results).toHaveLength(0);
    });

    it("handles orthogonal vectors (similarity ~0)", async () => {
      await dal.insertEmbedding("x-axis", [1, 0, 0], "model", undefined, defaultScope);
      const results = await dal.searchByCosineSimilarity([0, 1, 0], 1, defaultScope);
      expect(results[0].similarity).toBeCloseTo(0.0, 5);
    });

    it("handles identical vectors (similarity 1.0)", async () => {
      await dal.insertEmbedding("match", [0.3, 0.4, 0.5], "model", undefined, defaultScope);
      const results = await dal.searchByCosineSimilarity([0.3, 0.4, 0.5], 1, defaultScope);
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
    });

    it("handles opposite vectors (similarity -1.0)", async () => {
      await dal.insertEmbedding("opposite", [1, 0], "model", undefined, defaultScope);
      const results = await dal.searchByCosineSimilarity([-1, 0], 1, defaultScope);
      expect(results[0].similarity).toBeCloseTo(-1.0, 5);
    });
  });

  describe("deleteByLabel", () => {
    it("removes embeddings by label", async () => {
      await dal.insertEmbedding("to-delete", [1, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("to-keep", [0, 1], "model", undefined, defaultScope);

      const count = await dal.deleteByLabel("to-delete", defaultScope);
      expect(count).toBe(1);

      const remaining = await dal.list(defaultScope);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].label).toBe("to-keep");
    });

    it("returns 0 for non-existent label", async () => {
      const count = await dal.deleteByLabel("nonexistent", defaultScope);
      expect(count).toBe(0);
    });

    it("deletes all rows with same label", async () => {
      // Insert two with same label (different embedding_ids)
      await dal.insertEmbedding("duplicate", [1, 0], "model", undefined, defaultScope);
      await dal.insertEmbedding("duplicate", [0, 1], "model", undefined, defaultScope);

      const count = await dal.deleteByLabel("duplicate", defaultScope);
      expect(count).toBe(2);
    });
  });

  describe("list", () => {
    it("lists embeddings ordered by creation time descending", async () => {
      await dal.insertEmbedding("first", [1], "model", undefined, defaultScope);
      await dal.insertEmbedding("second", [2], "model", undefined, defaultScope);

      const items = await dal.list(defaultScope);
      expect(items).toHaveLength(2);
      expect(items[0].label).toBe("second");
      expect(items[1].label).toBe("first");
    });

    it("returns empty when no embeddings exist", async () => {
      const items = await dal.list(defaultScope);
      expect(items).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("returns undefined for unknown id", async () => {
      const result = await dal.getById("nonexistent-uuid", defaultScope);
      expect(result).toBeUndefined();
    });
  });
});
