import type {
  BuiltinMemoryServerSettings,
  MemoryItem,
  MemoryItemFilter,
  MemorySensitivity,
} from "@tyrum/schemas";
import { normalizeSnippet, truncate } from "./v1-dal-helpers.js";
import type { MemoryV1SemanticSearchHit } from "./v1-semantic-index.js";
import type { MemoryV1Dal } from "./v1-dal.js";

export type MemoryV1MatchSource = "structured" | "keyword" | "semantic";

export type MemoryV1RetrievedHit = {
  item: MemoryItem;
  score: number;
  match_sources: MemoryV1MatchSource[];
  keyword_score: number;
  semantic_score: number;
  structured_rank?: number;
};

export type MemoryV1RetrievalResult = {
  hits: MemoryV1RetrievedHit[];
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
};

type CandidateState = {
  memory_item_id: string;
  match_sources: Set<MemoryV1MatchSource>;
  keyword_score: number;
  semantic_score: number;
  structured_rank?: number;
  item?: MemoryItem;
};

function sensitivityAllowed(
  sensitivity: MemorySensitivity,
  allow: readonly MemorySensitivity[],
): boolean {
  return allow.includes(sensitivity);
}

function mergeSensitivityFilter(
  allowSensitivities: readonly MemorySensitivity[],
  filter?: MemoryItemFilter,
): MemoryItemFilter {
  const filtered = filter?.sensitivities
    ? filter.sensitivities.filter((value) => allowSensitivities.includes(value))
    : [...allowSensitivities];
  return {
    ...filter,
    sensitivities: filtered,
  };
}

async function loadStructuredItems(params: {
  dal: MemoryV1Dal;
  tenantId: string;
  agentId: string;
  allow_sensitivities: readonly MemorySensitivity[];
  structured: BuiltinMemoryServerSettings["structured"];
  maxItems: number;
}): Promise<MemoryItem[]> {
  const factKeys = params.structured.fact_keys ?? [];
  const tags = params.structured.tags ?? [];
  const out: MemoryItem[] = [];

  if (factKeys.length > 0) {
    const { items } = await params.dal.list({
      tenantId: params.tenantId,
      agentId: params.agentId,
      limit: Math.max(1, Math.min(200, Math.max(factKeys.length * 3, 20))),
      filter: {
        kinds: ["fact"],
        keys: factKeys,
        sensitivities: [...params.allow_sensitivities],
      },
    });

    const newestByKey = new Map<string, MemoryItem>();
    for (const item of items) {
      if (item.kind !== "fact" || newestByKey.has(item.key)) continue;
      newestByKey.set(item.key, item);
    }

    for (const key of factKeys) {
      const item = newestByKey.get(key);
      if (item) out.push(item);
      if (out.length >= params.maxItems) return out;
    }
  }

  if (tags.length > 0 && out.length < params.maxItems) {
    const { items } = await params.dal.list({
      tenantId: params.tenantId,
      agentId: params.agentId,
      limit: Math.max(1, Math.min(200, Math.max(params.maxItems * 2, 20))),
      filter: {
        tags,
        sensitivities: [...params.allow_sensitivities],
      },
    });

    const seen = new Set(out.map((item) => item.memory_item_id));
    for (const item of items) {
      if (seen.has(item.memory_item_id)) continue;
      out.push(item);
      seen.add(item.memory_item_id);
      if (out.length >= params.maxItems) break;
    }
  }

  return out;
}

function buildPreview(item: MemoryItem, maxChars = 240): string {
  if (item.kind === "fact") {
    let rendered = "";
    try {
      rendered = JSON.stringify(item.value);
    } catch {
      // Intentional: fall back to string coercion for non-JSON-serializable fact values.
      rendered = String(item.value);
    }
    return truncate(`${item.key}: ${rendered}`, maxChars);
  }

  if (item.kind === "episode") {
    return truncate(normalizeSnippet(item.summary_md), maxChars);
  }

  return truncate(normalizeSnippet(item.body_md), maxChars);
}

function compareHits(left: MemoryV1RetrievedHit, right: MemoryV1RetrievedHit): number {
  const leftStructured = left.match_sources.includes("structured") ? 1 : 0;
  const rightStructured = right.match_sources.includes("structured") ? 1 : 0;
  if (leftStructured !== rightStructured) return rightStructured - leftStructured;

  if (left.match_sources.length !== right.match_sources.length) {
    return right.match_sources.length - left.match_sources.length;
  }
  if (left.keyword_score !== right.keyword_score) {
    return right.keyword_score - left.keyword_score;
  }
  if (left.semantic_score !== right.semantic_score) {
    return right.semantic_score - left.semantic_score;
  }
  if (left.structured_rank !== undefined && right.structured_rank !== undefined) {
    if (left.structured_rank !== right.structured_rank) {
      return left.structured_rank - right.structured_rank;
    }
  }
  if (left.item.created_at !== right.item.created_at) {
    return right.item.created_at.localeCompare(left.item.created_at);
  }
  return left.item.memory_item_id.localeCompare(right.item.memory_item_id);
}

export function buildMemoryV1Preview(item: MemoryItem, maxChars = 240): string {
  return buildPreview(item, maxChars);
}

export async function retrieveMemoryV1(params: {
  dal: MemoryV1Dal;
  tenantId: string;
  agentId: string;
  query: string;
  allow_sensitivities: readonly MemorySensitivity[];
  filter?: MemoryItemFilter;
  structured?: BuiltinMemoryServerSettings["structured"];
  structuredMaxItems?: number;
  keywordLimit?: number;
  semanticLimit?: number;
  semanticSearch?: (query: string, limit: number) => Promise<MemoryV1SemanticSearchHit[]>;
}): Promise<MemoryV1RetrievalResult> {
  const query = params.query.trim();
  const candidates = new Map<string, CandidateState>();
  const scope = { tenantId: params.tenantId, agentId: params.agentId };
  const structuredFactKeys = params.structured?.fact_keys ?? [];
  const structuredTags = params.structured?.tags ?? [];

  const rememberCandidate = (memoryItemId: string): CandidateState => {
    const existing = candidates.get(memoryItemId);
    if (existing) return existing;
    const created: CandidateState = {
      memory_item_id: memoryItemId,
      match_sources: new Set<MemoryV1MatchSource>(),
      keyword_score: 0,
      semantic_score: 0,
    };
    candidates.set(memoryItemId, created);
    return created;
  };

  let structuredItems: MemoryItem[] = [];
  if (params.structured && (structuredFactKeys.length > 0 || structuredTags.length > 0)) {
    structuredItems = await loadStructuredItems({
      dal: params.dal,
      tenantId: params.tenantId,
      agentId: params.agentId,
      allow_sensitivities: params.allow_sensitivities,
      structured: params.structured,
      maxItems: Math.max(1, Math.min(200, params.structuredMaxItems ?? 20)),
    });

    for (const [index, item] of structuredItems.entries()) {
      const candidate = rememberCandidate(item.memory_item_id);
      candidate.match_sources.add("structured");
      candidate.structured_rank ??= index;
      candidate.item = item;
    }
  }

  const keywordLimit = Math.max(0, Math.floor(params.keywordLimit ?? 0));
  if (query.length > 0 && keywordLimit > 0) {
    try {
      const keywordHits = await params.dal.search(
        {
          query,
          limit: keywordLimit,
          filter: mergeSensitivityFilter(params.allow_sensitivities, params.filter),
        },
        scope,
      );

      for (const hit of keywordHits.hits) {
        const candidate = rememberCandidate(hit.memory_item_id);
        candidate.match_sources.add("keyword");
        candidate.keyword_score = Math.max(candidate.keyword_score, hit.score);
      }
    } catch {
      // Intentional: retrieval remains best-effort when keyword search rejects a query.
    }
  }

  const semanticLimit = Math.max(0, Math.floor(params.semanticLimit ?? 0));
  let semanticHits: MemoryV1SemanticSearchHit[] = [];
  if (query.length > 0 && semanticLimit > 0 && params.semanticSearch) {
    try {
      semanticHits = await params.semanticSearch(query, semanticLimit);
      for (const hit of semanticHits) {
        const candidate = rememberCandidate(hit.memory_item_id);
        candidate.match_sources.add("semantic");
        candidate.semantic_score = Math.max(candidate.semantic_score, hit.score);
      }
    } catch {
      // Intentional: semantic retrieval is best-effort and should not block structured/keyword hits.
      semanticHits = [];
    }
  }

  const hits: MemoryV1RetrievedHit[] = [];
  const mergedFilter = mergeSensitivityFilter(params.allow_sensitivities, params.filter);
  const allowedKinds = mergedFilter.kinds ? new Set(mergedFilter.kinds) : undefined;

  for (const candidate of candidates.values()) {
    let item: MemoryItem | undefined;
    try {
      item = candidate.item ?? (await params.dal.getById(candidate.memory_item_id, scope));
    } catch {
      // Intentional: skip candidates whose backing item can no longer be loaded.
      continue;
    }
    if (!item) continue;
    if (!sensitivityAllowed(item.sensitivity, params.allow_sensitivities)) continue;
    if (allowedKinds && !allowedKinds.has(item.kind)) continue;

    if (mergedFilter.tags && mergedFilter.tags.length > 0) {
      if (!mergedFilter.tags.some((tag) => item.tags.includes(tag))) continue;
    }

    hits.push({
      item,
      score: Math.max(candidate.keyword_score, candidate.semantic_score),
      match_sources: [...candidate.match_sources.values()].toSorted((left, right) =>
        left.localeCompare(right),
      ),
      keyword_score: candidate.keyword_score,
      semantic_score: candidate.semantic_score,
      ...(candidate.structured_rank !== undefined
        ? { structured_rank: candidate.structured_rank }
        : {}),
    });
  }

  hits.sort(compareHits);

  return {
    hits,
    keyword_hit_count: [...candidates.values()].filter((candidate) =>
      candidate.match_sources.has("keyword"),
    ).length,
    semantic_hit_count: [...candidates.values()].filter((candidate) =>
      candidate.match_sources.has("semantic"),
    ).length,
    structured_item_count: structuredItems.length,
  };
}
