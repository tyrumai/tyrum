import type { MemoryItemKind, MemorySensitivity } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../identity/scope.js";
import { VectorDal, cosineSimilarity } from "./vector-dal.js";

export interface MemoryV1Embedder {
  modelId: string;
  embed(text: string): Promise<number[]>;
}

export interface MemoryV1SemanticIndexOptions {
  db: SqlDb;
  tenantId?: string;
  agentId?: string;
  embedder: MemoryV1Embedder;
  maxEmbedChars?: number;
}

type MemoryEmbeddingCandidateRow = {
  memory_item_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  title: string | null;
  body_md: string | null;
  summary_md: string | null;
};

type MemoryEmbeddingJoinedRow = {
  memory_item_id: string;
  kind: MemoryItemKind;
  title: string | null;
  body_md: string | null;
  summary_md: string | null;
  vector_data: string | null;
};

function normalizeTenantId(tenantId?: string): string {
  const trimmed = tenantId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TENANT_ID;
}

function normalizeAgentId(agentId?: string): string {
  const trimmed = agentId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_AGENT_ID;
}

function assertFiniteVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value)) {
    throw new Error("embedding vector is not an array");
  }
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error("embedding vector contains non-numeric values");
  }
}

function trimForEmbedding(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildIndexText(
  row: Pick<MemoryEmbeddingCandidateRow, "kind" | "title" | "body_md" | "summary_md">,
): string | undefined {
  const parts: string[] = [];
  if (row.kind === "note" || row.kind === "procedure") {
    if (row.title) parts.push(row.title);
    if (row.body_md) parts.push(row.body_md);
  } else if (row.kind === "episode") {
    if (row.summary_md) parts.push(row.summary_md);
  }

  const raw = parts.join("\n\n").trim();
  return raw.length > 0 ? raw : undefined;
}

function buildSnippetFromText(text: string): string | undefined {
  const normalized = normalizeSnippet(text);
  if (normalized.length === 0) return undefined;
  return normalized.length <= 200 ? normalized : `${normalized.slice(0, 197)}...`;
}

function embeddingTextForRow(
  row: MemoryEmbeddingCandidateRow,
  maxChars: number,
): { label: string; text: string; snippet?: string } | undefined {
  if (row.sensitivity === "sensitive") return undefined;
  if (row.kind === "fact") return undefined;

  const indexText = buildIndexText(row);
  if (!indexText) return undefined;
  const snippet = buildSnippetFromText(indexText);

  return {
    label: `memory_item:${row.memory_item_id}`,
    text: trimForEmbedding(indexText, maxChars),
    ...(snippet ? { snippet } : {}),
  };
}

export type MemoryV1SemanticSearchHit = {
  memory_item_id: string;
  kind: MemoryItemKind;
  score: number;
  snippet?: string;
};

export class MemoryV1SemanticIndex {
  private readonly db: SqlDb;
  private readonly tenantId: string;
  private readonly agentId: string;
  private readonly embedder: MemoryV1Embedder;
  private readonly vectorDal: VectorDal;
  private readonly maxEmbedChars: number;

  constructor(opts: MemoryV1SemanticIndexOptions) {
    this.db = opts.db;
    this.tenantId = normalizeTenantId(opts.tenantId);
    this.agentId = normalizeAgentId(opts.agentId);
    this.embedder = opts.embedder;
    this.vectorDal = new VectorDal(opts.db);
    this.maxEmbedChars = Math.max(256, Math.floor(opts.maxEmbedChars ?? 4000));
  }

  async drop(): Promise<{ deleted_vectors: number; deleted_links: number }> {
    const deletedVectors = (
      await this.db.run(
        `DELETE FROM vector_metadata
         WHERE tenant_id = ?
           AND agent_id = ?
           AND label LIKE ?`,
        [this.tenantId, this.agentId, "memory_item:%"],
      )
    ).changes;

    const deletedLinks = (
      await this.db.run(
        `DELETE FROM memory_item_embeddings
         WHERE tenant_id = ? AND agent_id = ?`,
        [this.tenantId, this.agentId],
      )
    ).changes;

    return { deleted_vectors: deletedVectors, deleted_links: deletedLinks };
  }

  async rebuild(): Promise<{ indexed: number; skipped: number }> {
    await this.drop();

    const candidates = await this.db.all<MemoryEmbeddingCandidateRow>(
      `SELECT memory_item_id, kind, sensitivity, title, body_md, summary_md
       FROM memory_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND kind IN ('note', 'procedure', 'episode')
       ORDER BY created_at DESC`,
      [this.tenantId, this.agentId],
    );

    let indexed = 0;
    let skipped = 0;

    for (const row of candidates) {
      const eligible = embeddingTextForRow(row, this.maxEmbedChars);
      if (!eligible) {
        skipped += 1;
        continue;
      }

      let vector: number[];
      try {
        const embedded = await this.embedder.embed(eligible.text);
        assertFiniteVector(embedded as unknown);
        vector = embedded;
      } catch {
        // Intentional: best-effort semantic indexing; skip rows when embedding fails.
        skipped += 1;
        continue;
      }

      const embeddingId = await this.vectorDal.insertEmbedding(
        eligible.label,
        vector,
        this.embedder.modelId,
        { memory_item_id: row.memory_item_id, kind: row.kind, snippet: eligible.snippet },
        { tenantId: this.tenantId, agentId: this.agentId },
      );

      await this.db.run(
        `INSERT INTO memory_item_embeddings (
           tenant_id,
           agent_id,
           memory_item_id,
           embedding_id,
           embedding_model,
           vector_data
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, agent_id, memory_item_id, embedding_id) DO NOTHING`,
        [
          this.tenantId,
          this.agentId,
          row.memory_item_id,
          embeddingId,
          this.embedder.modelId,
          JSON.stringify(vector),
        ],
      );

      indexed += 1;
    }

    return { indexed, skipped };
  }

  async search(query: string, limit: number): Promise<MemoryV1SemanticSearchHit[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) return [];
    const topK = Math.max(0, Math.floor(limit));
    if (topK === 0) return [];

    const embedded = await this.embedder.embed(normalizedQuery);
    assertFiniteVector(embedded as unknown);
    const queryVector = embedded;

    const rows = await this.db.all<MemoryEmbeddingJoinedRow>(
      `SELECT e.memory_item_id, m.kind, m.title, m.body_md, m.summary_md, e.vector_data
       FROM memory_item_embeddings e
       JOIN memory_items m
         ON m.tenant_id = e.tenant_id
        AND m.agent_id = e.agent_id
        AND m.memory_item_id = e.memory_item_id
       WHERE e.tenant_id = ?
         AND e.agent_id = ?
         AND m.sensitivity <> 'sensitive'
         AND m.kind IN ('note', 'procedure', 'episode')
         AND e.vector_data IS NOT NULL`,
      [this.tenantId, this.agentId],
    );

    const bestByItem = new Map<
      string,
      { memory_item_id: string; kind: MemoryItemKind; similarity: number; snippet?: string }
    >();

    for (const row of rows) {
      if (!row.vector_data) continue;

      let vector: number[];
      try {
        const parsed = JSON.parse(row.vector_data) as unknown;
        assertFiniteVector(parsed);
        vector = parsed;
      } catch {
        // Intentional: best-effort semantic search; skip invalid/corrupt stored vectors.
        continue;
      }

      const similarity = cosineSimilarity(queryVector, vector);
      if (similarity <= 0) continue;

      const existing = bestByItem.get(row.memory_item_id);
      if (existing && existing.similarity >= similarity) continue;

      const indexText = buildIndexText(row);
      const snippet = indexText ? buildSnippetFromText(indexText) : undefined;
      bestByItem.set(row.memory_item_id, {
        memory_item_id: row.memory_item_id,
        kind: row.kind,
        similarity,
        ...(snippet ? { snippet } : {}),
      });
    }

    return [...bestByItem.values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map((hit) => ({
        memory_item_id: hit.memory_item_id,
        kind: hit.kind,
        score: Math.max(0, hit.similarity),
        ...(hit.snippet ? { snippet: hit.snippet } : {}),
      }));
  }
}
