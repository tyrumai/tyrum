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
  vector_metadata_id: number;
  tenant_id: string;
  agent_id: string;
  embedding_id: string;
  embedding_model: string;
  label: string | null;
  metadata_json: string | null;
  vector_data: string | null;
  created_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toVectorRow(raw: RawVectorRow): VectorRow {
  let metadata: unknown = {};
  try {
    if (raw.metadata_json) metadata = JSON.parse(raw.metadata_json) as unknown;
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
    id: raw.vector_metadata_id,
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

export interface VectorScope {
  tenantId: string;
  agentId: string;
}

function normalizeScope(scope: VectorScope | undefined): { tenantId: string; agentId: string } {
  if (!scope) throw new Error("scope is required");
  const tenantId = scope.tenantId.trim();
  const agentId = scope.agentId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!agentId) throw new Error("agentId is required");
  return { tenantId, agentId };
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

  /** Insert a vector embedding. Returns the embedding_id. */
  async insertEmbedding(
    label: string,
    vector: number[],
    model: string,
    metadata?: unknown,
    scope?: VectorScope,
  ): Promise<string> {
    const resolved = normalizeScope(scope);
    const embeddingId = randomUUID();

    await this.db.run(
      `INSERT INTO vector_metadata (
         tenant_id,
         agent_id,
         embedding_id,
         embedding_model,
         label,
         metadata_json,
         vector_data
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        resolved.tenantId,
        resolved.agentId,
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
    scope?: VectorScope,
  ): Promise<VectorSearchResult[]> {
    const resolved = normalizeScope(scope);
    const rows = await this.db.all<RawVectorRow>(
      `SELECT * FROM vector_metadata
       WHERE tenant_id = ? AND agent_id = ?
         AND vector_data IS NOT NULL
       ORDER BY created_at DESC`,
      [resolved.tenantId, resolved.agentId],
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
  async deleteByLabel(label: string, scope?: VectorScope): Promise<number> {
    const resolved = normalizeScope(scope);
    return (
      await this.db.run(
        "DELETE FROM vector_metadata WHERE tenant_id = ? AND agent_id = ? AND label = ?",
        [resolved.tenantId, resolved.agentId, label],
      )
    ).changes;
  }

  /** Get a single embedding by its embedding_id. */
  async getById(embeddingId: string, scope?: VectorScope): Promise<VectorRow | undefined> {
    const resolved = normalizeScope(scope);
    const raw = await this.db.get<RawVectorRow>(
      "SELECT * FROM vector_metadata WHERE tenant_id = ? AND agent_id = ? AND embedding_id = ?",
      [resolved.tenantId, resolved.agentId, embeddingId],
    );

    return raw ? toVectorRow(raw) : undefined;
  }

  /** List all embeddings, ordered by creation time descending. */
  async list(scope?: VectorScope): Promise<VectorRow[]> {
    const resolved = normalizeScope(scope);
    const rows = await this.db.all<RawVectorRow>(
      "SELECT * FROM vector_metadata WHERE tenant_id = ? AND agent_id = ? ORDER BY created_at DESC, vector_metadata_id DESC",
      [resolved.tenantId, resolved.agentId],
    );
    return rows.map(toVectorRow);
  }
}
