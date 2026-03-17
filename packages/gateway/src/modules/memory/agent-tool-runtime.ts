import type {
  BuiltinMemorySearchArgs,
  BuiltinMemorySeedArgs,
  BuiltinMemoryServerSettings,
  BuiltinMemoryWriteArgs,
  MemoryItem,
  MemoryItemKind,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { MemoryDal } from "./memory-dal.js";
import { retrieveMemory, buildMemoryPreview } from "./memory-retrieval.js";
import { MemorySemanticIndex } from "./memory-semantic-index.js";
import { buildMemoryDigest } from "./memory-digest.js";

type MemoryToolEmbeddingPipeline = {
  embed(text: string): Promise<number[]>;
};

type MemoryWriteProvenance = {
  source_kind: "tool";
  session_id: string;
  tool_call_id: string;
  refs: [];
  metadata: { tool_id: string };
  channel?: string;
  thread_id?: string;
};

export interface AgentMemoryToolRuntimeOptions {
  db: SqlDb;
  dal: MemoryDal;
  tenantId: string;
  agentId: string;
  sessionId: string;
  channel?: string;
  threadId?: string;
  config: BuiltinMemoryServerSettings;
  budgetsProvider: () => Promise<BuiltinMemoryServerSettings["budgets"]>;
  resolveEmbeddingPipeline?: () => Promise<MemoryToolEmbeddingPipeline | undefined>;
}

function normalizeTags(input: string[] | undefined): string[] {
  if (!input) return [];
  const tags = input.map((value) => value.trim()).filter((value) => value.length > 0);
  return [...new Set(tags)].toSorted((left, right) => left.localeCompare(right));
}

function normalizeKinds(input: MemoryItemKind[] | undefined): MemoryItemKind[] | undefined {
  if (!input || input.length === 0) return undefined;
  return [...new Set(input)].toSorted((left, right) => left.localeCompare(right));
}

function buildSearchProvenance(item: MemoryItem): Record<string, string> {
  const out: Record<string, string> = {
    source_kind: item.provenance.source_kind,
  };
  if (item.provenance.channel) out["channel"] = item.provenance.channel;
  if (item.provenance.thread_id) out["thread_id"] = item.provenance.thread_id;
  if (item.provenance.session_id) out["session_id"] = item.provenance.session_id;
  return out;
}

function buildSearchHit(
  item: MemoryItem,
  score: number,
  matchSources: string[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    memory_item_id: item.memory_item_id,
    kind: item.kind,
    score: Number(score.toFixed(4)),
    match_sources: matchSources,
    tags: item.tags,
    sensitivity: item.sensitivity,
    provenance: buildSearchProvenance(item),
    preview: buildMemoryPreview(item),
  };

  if (item.kind === "fact") {
    base["key"] = item.key;
    return base;
  }
  if (item.kind === "note" || item.kind === "procedure") {
    if (item.title) base["title"] = item.title;
    return base;
  }
  return base;
}

export class AgentMemoryToolRuntime {
  private readonly scope: { tenantId: string; agentId: string };

  constructor(private readonly opts: AgentMemoryToolRuntimeOptions) {
    this.scope = {
      tenantId: opts.tenantId.trim(),
      agentId: opts.agentId.trim(),
    };
  }

  private async createSemanticIndex(): Promise<MemorySemanticIndex | undefined> {
    if (!this.opts.config.semantic.enabled || !this.opts.resolveEmbeddingPipeline) {
      return undefined;
    }
    const pipeline = await this.opts.resolveEmbeddingPipeline();
    if (!pipeline) return undefined;
    return new MemorySemanticIndex({
      db: this.opts.db,
      tenantId: this.scope.tenantId,
      agentId: this.scope.agentId,
      embedder: {
        modelId: "runtime/embedding",
        embed: async (text: string) => await pipeline.embed(text),
      },
    });
  }

  async search(input: BuiltinMemorySearchArgs): Promise<Record<string, unknown>> {
    const limit = Math.max(1, Math.min(10, Math.floor(input.limit ?? 5)));
    const kinds = normalizeKinds(input.kinds);
    const tags = normalizeTags(input.tags);
    const filter =
      (kinds && kinds.length > 0) || tags.length > 0
        ? {
            ...(kinds && kinds.length > 0 ? { kinds } : {}),
            ...(tags.length > 0 ? { tags } : {}),
          }
        : undefined;

    let semanticAvailable = false;
    let semanticFallbackUsed = false;
    const semanticIndex = await this.createSemanticIndex().catch(() => undefined);
    const semanticSearch =
      semanticIndex &&
      (async (query: string, semanticLimit: number) => {
        await semanticIndex.ensureFresh();
        return await semanticIndex.search(query, semanticLimit);
      });
    if (semanticSearch) {
      semanticAvailable = true;
    } else if (this.opts.config.semantic.enabled) {
      semanticFallbackUsed = true;
    }

    const retrieval = await retrieveMemory({
      dal: this.opts.dal,
      tenantId: this.scope.tenantId,
      agentId: this.scope.agentId,
      query: input.query,
      filter,
      allow_sensitivities: this.opts.config.allow_sensitivities ?? ["public", "private"],
      keywordLimit: Math.max(20, limit * 5),
      semanticLimit: semanticSearch ? Math.max(limit * 3, limit) : 0,
      semanticSearch,
    });

    return {
      status: "ok",
      query: input.query.trim(),
      hits: retrieval.hits
        .slice(0, limit)
        .map((hit) => buildSearchHit(hit.item, hit.score, hit.match_sources)),
      semantic_available: semanticAvailable,
      semantic_fallback_used: semanticFallbackUsed,
      keyword_hit_count: retrieval.keyword_hit_count,
      semantic_hit_count: retrieval.semantic_hit_count,
    };
  }

  async seed(input: BuiltinMemorySeedArgs): Promise<Record<string, unknown>> {
    const semanticIndex = await this.createSemanticIndex().catch(() => undefined);
    const semanticSearch =
      semanticIndex &&
      (async (query: string, semanticLimit: number) => {
        await semanticIndex.ensureFresh();
        return await semanticIndex.search(query, semanticLimit);
      });

    const digest = await buildMemoryDigest({
      dal: this.opts.dal,
      tenantId: this.scope.tenantId,
      agentId: this.scope.agentId,
      query: input.query.trim(),
      config: this.opts.config,
      semanticSearch,
    });

    return {
      status: "ok",
      query: input.query.trim(),
      ...digest,
    };
  }

  async add(
    input: BuiltinMemoryWriteArgs,
    toolCallId: string,
    sourceToolId = "mcp.memory.write",
  ): Promise<Record<string, unknown>> {
    const nowIso = new Date().toISOString();
    const tags = normalizeTags(input.tags);
    const sensitivity = input.sensitivity ?? "private";
    const provenance: MemoryWriteProvenance = {
      source_kind: "tool" as const,
      session_id: this.opts.sessionId,
      tool_call_id: toolCallId,
      refs: [],
      metadata: { tool_id: sourceToolId },
    };
    if (typeof this.opts.channel === "string" && this.opts.channel.trim().length > 0) {
      provenance.channel = this.opts.channel;
    }
    if (typeof this.opts.threadId === "string" && this.opts.threadId.trim().length > 0) {
      provenance.thread_id = this.opts.threadId;
    }
    const created = await this.opts.dal.create(
      input.kind === "fact"
        ? {
            kind: "fact",
            key: input.key,
            value: input.value,
            confidence: input.confidence ?? 1,
            observed_at: input.observed_at ?? nowIso,
            tags,
            sensitivity,
            provenance,
          }
        : input.kind === "note"
          ? {
              kind: "note",
              title: input.title,
              body_md: input.body_md,
              tags,
              sensitivity,
              provenance,
            }
          : input.kind === "procedure"
            ? {
                kind: "procedure" as const,
                title: input.title,
                body_md: input.body_md,
                confidence: input.confidence,
                tags,
                sensitivity,
                provenance,
              }
            : {
                kind: "episode" as const,
                occurred_at: input.occurred_at ?? nowIso,
                summary_md: input.summary_md,
                tags,
                sensitivity,
                provenance,
              },
      this.scope,
    );

    const budgets = await this.opts.budgetsProvider();
    await this.opts.dal.consolidateToBudgets({
      tenantId: this.scope.tenantId,
      agentId: this.scope.agentId,
      budgets,
    });

    let semanticIndexed = false;
    if (created.kind === "note" || created.kind === "procedure") {
      const semanticIndex = await this.createSemanticIndex().catch(() => undefined);
      if (semanticIndex) {
        await semanticIndex.rebuild();
        semanticIndexed = true;
      }
    }

    return {
      status: "ok",
      item: created,
      semantic_indexed: semanticIndexed,
    };
  }

  async write(input: BuiltinMemoryWriteArgs, toolCallId: string): Promise<Record<string, unknown>> {
    return await this.add(input, toolCallId, "mcp.memory.write");
  }
}
