/**
 * Embedding pipeline — uses AI SDK embedding models and integrates with VectorDal.
 */

import { embed, type EmbeddingModel } from "ai";
import type { VectorDal, VectorScope, VectorSearchResult } from "./vector-dal.js";

export interface EmbeddingPipelineOptions {
  vectorDal: VectorDal;
  scope: VectorScope;
  embeddingModel: EmbeddingModel;
  embeddingModelId: string;
}

export class EmbeddingPipeline {
  private readonly vectorDal: VectorDal;
  private readonly scope: VectorScope;
  private readonly embeddingModel: EmbeddingModel;
  private readonly embeddingModelId: string;

  constructor(opts: EmbeddingPipelineOptions) {
    this.vectorDal = opts.vectorDal;
    this.scope = {
      tenantId: opts.scope.tenantId.trim(),
      agentId: opts.scope.agentId.trim(),
    };
    this.embeddingModel = opts.embeddingModel;
    this.embeddingModelId = opts.embeddingModelId.trim();
  }

  /** Embed a single text value into a vector. */
  async embed(text: string): Promise<number[]> {
    const result = await embed({
      model: this.embeddingModel,
      value: text,
    });

    const embedding = result.embedding as unknown;
    if (!Array.isArray(embedding)) {
      throw new Error("Embedding result missing embedding array");
    }
    if (!embedding.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("Embedding result contains non-numeric values");
    }

    return embedding as number[];
  }

  /** Embed text and store it in the vector DAL. Returns the embedding_id. */
  async embedAndStore(text: string, label: string, metadata?: unknown): Promise<string> {
    const vector = await this.embed(text);
    return await this.vectorDal.insertEmbedding(
      label,
      vector,
      this.embeddingModelId,
      metadata,
      this.scope,
    );
  }

  /** Embed a query and search for similar vectors. Returns top K results. */
  async search(queryText: string, topK: number): Promise<VectorSearchResult[]> {
    const queryVector = await this.embed(queryText);
    return await this.vectorDal.searchByCosineSimilarity(queryVector, topK, this.scope);
  }
}
