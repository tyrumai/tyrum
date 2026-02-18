/**
 * Vector embedding data access layer.
 *
 * Stores vector embeddings in the vector_metadata table and provides
 * brute-force cosine similarity search over all stored vectors.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

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
  created_at: string;
}

function toVectorRow(raw: RawVectorRow): VectorRow {
  let metadata: unknown = {};
  try {
    if (raw.metadata) metadata = JSON.parse(raw.metadata) as unknown;
  } catch {
    // leave as empty object
  }

  let vector: number[] = [];
  try {
    if (raw.vector_data) vector = JSON.parse(raw.vector_data) as number[];
  } catch {
    // leave as empty array
  }

  return {
    id: raw.id,
    embedding_id: raw.embedding_id,
    embedding_model: raw.embedding_model,
    label: raw.label,
    metadata,
    vector,
    created_at: raw.created_at,
  };
}

export interface VectorSearchResult {
  row: VectorRow;
  similarity: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
  constructor(private readonly db: Database.Database) {}

  /** Insert a vector embedding. Returns the embedding_id. */
  insertEmbedding(
    label: string,
    vector: number[],
    model: string,
    metadata?: unknown,
  ): string {
    const embeddingId = randomUUID();

    this.db
      .prepare(
        `INSERT INTO vector_metadata (embedding_id, embedding_model, label, metadata, vector_data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        embeddingId,
        model,
        label,
        metadata !== undefined ? JSON.stringify(metadata) : null,
        JSON.stringify(vector),
      );

    return embeddingId;
  }

  /** Search by cosine similarity. Returns top K matches sorted by similarity descending. */
  searchByCosineSimilarity(
    queryVector: number[],
    topK: number,
  ): VectorSearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM vector_metadata
         WHERE vector_data IS NOT NULL
         ORDER BY created_at DESC`,
      )
      .all() as RawVectorRow[];

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
  deleteByLabel(label: string): number {
    const result = this.db
      .prepare("DELETE FROM vector_metadata WHERE label = ?")
      .run(label);
    return result.changes;
  }

  /** Get a single embedding by its embedding_id. */
  getById(embeddingId: string): VectorRow | undefined {
    const raw = this.db
      .prepare("SELECT * FROM vector_metadata WHERE embedding_id = ?")
      .get(embeddingId) as RawVectorRow | undefined;

    return raw ? toVectorRow(raw) : undefined;
  }

  /** List all embeddings, ordered by creation time descending. */
  list(): VectorRow[] {
    const rows = this.db
      .prepare("SELECT * FROM vector_metadata ORDER BY created_at DESC, id DESC")
      .all() as RawVectorRow[];
    return rows.map(toVectorRow);
  }
}
