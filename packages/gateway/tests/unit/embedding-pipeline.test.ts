import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { EmbeddingModel } from "ai";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const embedMock = vi.fn();

vi.mock("ai", () => ({
  embed: embedMock,
}));

const { EmbeddingPipeline } = await import("../../src/modules/memory/embedding-pipeline.js");

describe("EmbeddingPipeline", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let vectorDal: VectorDal;
  const embeddingModel = {} as unknown as EmbeddingModel;
  const embeddingModelId = "openai/text-embedding-3-small";
  const scope = { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID };

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    vectorDal = new VectorDal(db);
    embedMock.mockReset();
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  describe("embed", () => {
    it("calls ai.embed and returns vector", async () => {
      const mockVector = [0.1, 0.2, 0.3];
      embedMock.mockResolvedValueOnce({ embedding: mockVector });

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      const result = await pipeline.embed("hello world");
      expect(result).toEqual(mockVector);
      expect(embedMock).toHaveBeenCalledWith({ model: embeddingModel, value: "hello world" });
    });

    it("throws when embedding is missing", async () => {
      embedMock.mockResolvedValueOnce({ embedding: "nope" });

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      await expect(pipeline.embed("test")).rejects.toThrow(
        "Embedding result missing embedding array",
      );
    });

    it("throws when embedding contains non-numeric values", async () => {
      embedMock.mockResolvedValueOnce({ embedding: [1, "x"] });

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      await expect(pipeline.embed("test")).rejects.toThrow(
        "Embedding result contains non-numeric values",
      );
    });
  });

  describe("embedAndStore", () => {
    it("embeds text and stores it", async () => {
      const mockVector = [1.0, 0.0, 0.0];
      embedMock.mockResolvedValueOnce({ embedding: mockVector });
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      const id = await pipeline.embedAndStore("hello world", "greeting", { source: "test" });
      expect(id).toBeTruthy();

      const row = await vectorDal.getById(id, scope);
      expect(row).toBeDefined();
      expect(row!.label).toBe("greeting");
      expect(row!.vector).toEqual(mockVector);
      expect(row!.embedding_model).toBe(embeddingModelId);
    });
  });

  describe("search", () => {
    it("embeds query and searches stored vectors", async () => {
      // Pre-store some vectors
      await vectorDal.insertEmbedding("doc-a", [1, 0, 0], "test-model", undefined, scope);
      await vectorDal.insertEmbedding("doc-b", [0, 1, 0], "test-model", undefined, scope);
      await vectorDal.insertEmbedding("doc-c", [0.9, 0.1, 0], "test-model", undefined, scope);

      // Mock embed returns [1, 0, 0] for the query
      embedMock.mockResolvedValueOnce({ embedding: [1, 0, 0] });
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      const results = await pipeline.search("similar to doc-a", 2);
      expect(results).toHaveLength(2);
      expect(results[0].row.label).toBe("doc-a");
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[1].row.label).toBe("doc-c");
    });

    it("returns empty when no vectors stored", async () => {
      embedMock.mockResolvedValueOnce({ embedding: [1, 0, 0] });
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      const results = await pipeline.search("anything", 5);
      expect(results).toHaveLength(0);
    });
  });

  describe("embed -> store -> search cycle", () => {
    it("completes full embedding cycle", async () => {
      const vectors = [
        [0.8, 0.6, 0.0], // store call 1
        [0.1, 0.9, 0.1], // store call 2
        [0.7, 0.5, 0.1], // search query
      ];

      embedMock
        .mockResolvedValueOnce({ embedding: vectors[0] })
        .mockResolvedValueOnce({ embedding: vectors[1] })
        .mockResolvedValueOnce({ embedding: vectors[2] });

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        scope,
        embeddingModel,
        embeddingModelId,
      });

      await pipeline.embedAndStore("TypeScript guide", "typescript-doc");
      await pipeline.embedAndStore("Python tutorial", "python-doc");

      const results = await pipeline.search("TypeScript help", 2);
      expect(results).toHaveLength(2);
      // The query [0.7, 0.5, 0.1] is more similar to [0.8, 0.6, 0] than [0.1, 0.9, 0.1]
      expect(results[0].row.label).toBe("typescript-doc");
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });
  });
});
