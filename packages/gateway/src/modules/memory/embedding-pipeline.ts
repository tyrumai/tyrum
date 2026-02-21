/**
 * Embedding pipeline -- calls the model proxy /v1/embeddings endpoint
 * and integrates with VectorDal for storage and search.
 */

import type { VectorDal, VectorSearchResult } from "./vector-dal.js";

export interface EmbeddingPipelineOptions {
  vectorDal: VectorDal;
  agentId: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class EmbeddingPipeline {
  private readonly vectorDal: VectorDal;
  private readonly agentId: string;
  private readonly embeddingsUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EmbeddingPipelineOptions) {
    this.vectorDal = opts.vectorDal;
    this.agentId = opts.agentId;
    const normalized = opts.baseUrl.replace(/\/$/, "");
    this.embeddingsUrl = normalized.endsWith("/v1")
      ? `${normalized}/embeddings`
      : `${normalized}/v1/embeddings`;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Call the embeddings endpoint to get a vector for text. */
  async embed(text: string): Promise<number[]> {
    const response = await this.fetchImpl(this.embeddingsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Embeddings request failed (${response.status}): ${body}`,
      );
    }

    const payload = (await response.json()) as EmbeddingsResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Embeddings response missing data[0].embedding");
    }

    return embedding;
  }

  /** Embed text and store it in the vector DAL. Returns the embedding_id. */
  async embedAndStore(
    text: string,
    label: string,
    metadata?: unknown,
  ): Promise<string> {
    const vector = await this.embed(text);
    return await this.vectorDal.insertEmbedding(this.agentId, label, vector, this.model, metadata);
  }

  /** Embed a query and search for similar vectors. Returns top K results. */
  async search(
    queryText: string,
    topK: number,
  ): Promise<VectorSearchResult[]> {
    const queryVector = await this.embed(queryText);
    return await this.vectorDal.searchByCosineSimilarity(this.agentId, queryVector, topK);
  }
}
