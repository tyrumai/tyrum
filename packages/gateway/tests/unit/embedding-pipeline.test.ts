import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { EmbeddingPipeline } from "../../src/modules/memory/embedding-pipeline.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function createMockFetch(embeddingVector: number[]) {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        data: [{ embedding: embeddingVector }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function createFailingFetch() {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response("Internal Server Error", { status: 500 });
  };
}

describe("EmbeddingPipeline", () => {
  let db: Database.Database;
  let vectorDal: VectorDal;

  beforeEach(() => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);
    vectorDal = new VectorDal(db);
  });

  describe("embed", () => {
    it("calls /v1/embeddings and returns vector", async () => {
      const mockVector = [0.1, 0.2, 0.3];
      let capturedUrl = "";
      let capturedBody: unknown;

      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === "string" ? url : url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ data: [{ embedding: mockVector }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "text-embedding-3",
        fetchImpl: mockFetch as typeof fetch,
      });

      const result = await pipeline.embed("hello world");
      expect(result).toEqual(mockVector);
      expect(capturedUrl).toBe("http://localhost:8080/v1/embeddings");
      expect((capturedBody as Record<string, unknown>).model).toBe("text-embedding-3");
      expect((capturedBody as Record<string, unknown>).input).toBe("hello world");
    });

    it("throws on non-OK response", async () => {
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "model",
        fetchImpl: createFailingFetch() as typeof fetch,
      });

      await expect(pipeline.embed("test")).rejects.toThrow("Embeddings request failed (500)");
    });

    it("handles base URL without /v1 suffix", async () => {
      let capturedUrl = "";
      const mockFetch = async (url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = typeof url === "string" ? url : url.toString();
        return new Response(
          JSON.stringify({ data: [{ embedding: [1] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080",
        model: "model",
        fetchImpl: mockFetch as typeof fetch,
      });

      await pipeline.embed("test");
      expect(capturedUrl).toBe("http://localhost:8080/v1/embeddings");
    });
  });

  describe("embedAndStore", () => {
    it("embeds text and stores it", async () => {
      const mockVector = [1.0, 0.0, 0.0];
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "test-model",
        fetchImpl: createMockFetch(mockVector) as typeof fetch,
      });

      const id = await pipeline.embedAndStore("hello world", "greeting", { source: "test" });
      expect(id).toBeTruthy();

      const row = vectorDal.getById(id);
      expect(row).toBeDefined();
      expect(row!.label).toBe("greeting");
      expect(row!.vector).toEqual(mockVector);
      expect(row!.embedding_model).toBe("test-model");
    });
  });

  describe("search", () => {
    it("embeds query and searches stored vectors", async () => {
      // Pre-store some vectors
      vectorDal.insertEmbedding("doc-a", [1, 0, 0], "test-model");
      vectorDal.insertEmbedding("doc-b", [0, 1, 0], "test-model");
      vectorDal.insertEmbedding("doc-c", [0.9, 0.1, 0], "test-model");

      // Mock embed returns [1, 0, 0] for the query
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "test-model",
        fetchImpl: createMockFetch([1, 0, 0]) as typeof fetch,
      });

      const results = await pipeline.search("similar to doc-a", 2);
      expect(results).toHaveLength(2);
      expect(results[0].row.label).toBe("doc-a");
      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[1].row.label).toBe("doc-c");
    });

    it("returns empty when no vectors stored", async () => {
      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "test-model",
        fetchImpl: createMockFetch([1, 0, 0]) as typeof fetch,
      });

      const results = await pipeline.search("anything", 5);
      expect(results).toHaveLength(0);
    });
  });

  describe("embed -> store -> search cycle", () => {
    it("completes full embedding cycle", async () => {
      let callCount = 0;
      const vectors = [
        [0.8, 0.6, 0.0],  // store call 1
        [0.1, 0.9, 0.1],  // store call 2
        [0.7, 0.5, 0.1],  // search query
      ];

      const mockFetch = async (_url: string | URL | Request, _init?: RequestInit) => {
        const vector = vectors[callCount] ?? [0, 0, 0];
        callCount++;
        return new Response(
          JSON.stringify({ data: [{ embedding: vector }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const pipeline = new EmbeddingPipeline({
        vectorDal,
        baseUrl: "http://localhost:8080/v1",
        model: "test-model",
        fetchImpl: mockFetch as typeof fetch,
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
