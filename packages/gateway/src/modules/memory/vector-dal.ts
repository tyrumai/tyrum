/**
 * Vector embedding data access layer.
 *
 * Stores vector embeddings in the vector_metadata table and provides
 * brute-force cosine similarity search over all stored vectors.
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface VectorRow {
  id: number;
  embedding_id: string;
  embedding_model: string;
  label: string | null;
  metadata: unknown;
  vector: number[];
  created_at: string;
}

interface RawVectorRow {
  id: number;
  embedding_id: string;
  embedding_model: string;
  label: string | null;
  metadata: string | null;
  vector_data: string | null;
  created_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toVectorRow(raw: RawVectorRow): VectorRow {
  let metadata: unknown = {};
  try {
    if (raw.metadata) metadata = JSON.parse(raw.metadata) as unknown;
  } catch {
    // Intentional: treat invalid JSON metadata as an empty object.
  }

  let vector: number[] = [];
  try {
    if (raw.vector_data) vector = JSON.parse(raw.vector_data) as number[];
  } catch {
    // Intentional: treat invalid JSON vectors as an empty array.
  }

  return {
    id: raw.id,
    embedding_id: raw.embedding_id,
    embedding_model: raw.embedding_model,
    label: raw.label,
    metadata,
    vector,
    created_at: normalizeTime(raw.created_at),
  };
}

export interface VectorSearchResult {
  row: VectorRow;
  similarity: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

export class VectorDal {
  constructor(private readonly db: SqlDb) {}

  private normalizeAgentId(agentId?: string): string {
    const trimmed = agentId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "default";
  }

  /** Insert a vector embedding. Returns the embedding_id. */
  async insertEmbedding(
    label: string,
    vector: number[],
    model: string,
    metadata?: unknown,
    agentId?: string,
  ): Promise<string> {
    const embeddingId = randomUUID();

    await this.db.run(
      `INSERT INTO vector_metadata (agent_id, embedding_id, embedding_model, label, metadata, vector_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        this.normalizeAgentId(agentId),
        embeddingId,
        model,
        label,
        metadata !== undefined ? JSON.stringify(metadata) : null,
        JSON.stringify(vector),
      ],
    );

    return embeddingId;
  }

  /** Search by cosine similarity. Returns top K matches sorted by similarity descending. */
  async searchByCosineSimilarity(
    queryVector: number[],
    topK: number,
    agentId?: string,
  ): Promise<VectorSearchResult[]> {
    const rows = await this.db.all<RawVectorRow>(
      `SELECT * FROM vector_metadata
       WHERE agent_id = ?
         AND vector_data IS NOT NULL
       ORDER BY created_at DESC`,
      [this.normalizeAgentId(agentId)],
    );

    const scored: VectorSearchResult[] = [];

    for (const raw of rows) {
      const row = toVectorRow(raw);
      if (row.vector.length === 0) continue;
      const similarity = cosineSimilarity(queryVector, row.vector);
      scored.push({ row, similarity });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  /** Delete all embeddings with the given label. Returns the number of rows deleted. */
  async deleteByLabel(label: string, agentId?: string): Promise<number> {
    return (
      await this.db.run("DELETE FROM vector_metadata WHERE agent_id = ? AND label = ?", [
        this.normalizeAgentId(agentId),
        label,
      ])
    ).changes;
  }

  /** Get a single embedding by its embedding_id. */
  async getById(embeddingId: string): Promise<VectorRow | undefined> {
    const raw = await this.db.get<RawVectorRow>(
      "SELECT * FROM vector_metadata WHERE embedding_id = ?",
      [embeddingId],
    );

    return raw ? toVectorRow(raw) : undefined;
  }

  /** List all embeddings, ordered by creation time descending. */
  async list(agentId?: string): Promise<VectorRow[]> {
    const rows = await this.db.all<RawVectorRow>(
      "SELECT * FROM vector_metadata WHERE agent_id = ? ORDER BY created_at DESC, id DESC",
      [this.normalizeAgentId(agentId)],
    );
    return rows.map(toVectorRow);
  }
}
