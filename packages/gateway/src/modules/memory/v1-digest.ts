import type { AgentConfig, MemoryItem, MemoryItemKind, MemorySensitivity } from "@tyrum/schemas";
import type { MemoryV1SemanticSearchHit } from "./v1-semantic-index.js";
import type { MemoryV1Dal } from "./v1-dal.js";

export type MemoryV1DigestResult = {
  digest: string;
  included_item_ids: string[];
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
};

type DigestCandidate = {
  memory_item_id: string;
  kind: MemoryItemKind;
  source: "structured" | "keyword" | "semantic";
  score: number;
  item?: MemoryItem;
};

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3)}...`;
}

function estimateTokens(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  // Deterministic, provider-agnostic approximation (good enough for budgeting).
  return Math.ceil(trimmed.length / 4);
}

function formatProvenance(item: MemoryItem): string {
  const prov = item.provenance;
  const parts: string[] = [`prov=${prov.source_kind}`];
  if (prov.channel) parts.push(`channel=${prov.channel}`);
  if (prov.thread_id) parts.push(`thread=${prov.thread_id}`);
  if (prov.session_id) parts.push(`session=${prov.session_id}`);
  const refs = prov.refs ?? [];
  if (refs.length > 0) {
    const sample = refs.slice(0, 2).join(", ");
    parts.push(
      `refs=${String(refs.length)}${sample ? `(${sample}${refs.length > 2 ? ", ..." : ""})` : ""}`,
    );
  }
  return parts.join(" ");
}

function formatItemHeader(item: MemoryItem): string {
  if (item.kind === "fact") {
    let value = "";
    try {
      value = JSON.stringify(item.value);
    } catch {
      value = String(item.value);
    }
    const valueTrimmed = truncate(value, 240);
    return `key=${item.key} value=${valueTrimmed} conf=${item.confidence.toFixed(2)}`;
  }

  if (item.kind === "note") {
    const title = item.title ? normalizeSnippet(item.title) : "Note";
    return `title=${truncate(title, 120)}`;
  }

  if (item.kind === "procedure") {
    const title = item.title ? normalizeSnippet(item.title) : "Procedure";
    const conf = item.confidence !== undefined ? ` conf=${item.confidence.toFixed(2)}` : "";
    return `title=${truncate(title, 120)}${conf}`;
  }

  const occurred = normalizeSnippet(item.occurred_at);
  return `occurred_at=${occurred}`;
}

function itemSnippet(item: MemoryItem): string | undefined {
  if (item.kind === "note" || item.kind === "procedure") {
    const raw = normalizeSnippet(item.body_md);
    return raw.length > 0 ? raw : undefined;
  }
  if (item.kind === "episode") {
    const raw = normalizeSnippet(item.summary_md);
    return raw.length > 0 ? raw : undefined;
  }
  return undefined;
}

function resolveKindBudget(
  config: AgentConfig["memory"]["v1"]["budgets"]["per_kind"],
  kind: MemoryItemKind,
): { max_items: number; max_chars: number; max_tokens?: number } {
  const b = config[kind];
  return {
    max_items: Math.max(0, Math.floor(b.max_items)),
    max_chars: Math.max(0, Math.floor(b.max_chars)),
    ...(b.max_tokens !== undefined ? { max_tokens: Math.max(0, Math.floor(b.max_tokens)) } : {}),
  };
}

function sensitivityAllowed(
  sensitivity: MemorySensitivity,
  allow: readonly MemorySensitivity[],
): boolean {
  return allow.length === 0 ? sensitivity !== "sensitive" : allow.includes(sensitivity);
}

async function loadStructuredItems(params: {
  dal: MemoryV1Dal;
  agentId: string;
  allow_sensitivities: readonly MemorySensitivity[];
  structured: AgentConfig["memory"]["v1"]["structured"];
  maxItems: number;
}): Promise<MemoryItem[]> {
  const factKeys = params.structured.fact_keys ?? [];
  const tags = params.structured.tags ?? [];

  const out: MemoryItem[] = [];

  if (factKeys.length > 0) {
    const { items } = await params.dal.list({
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
      if (item.kind !== "fact") continue;
      if (!newestByKey.has(item.key)) {
        newestByKey.set(item.key, item);
      }
    }

    for (const key of factKeys) {
      const item = newestByKey.get(key);
      if (item) out.push(item);
      if (out.length >= params.maxItems) return out;
    }
  }

  if (tags.length > 0 && out.length < params.maxItems) {
    const { items } = await params.dal.list({
      agentId: params.agentId,
      limit: Math.max(1, Math.min(200, Math.max(params.maxItems * 2, 20))),
      filter: {
        tags,
        sensitivities: [...params.allow_sensitivities],
      },
    });

    for (const item of items) {
      out.push(item);
      if (out.length >= params.maxItems) break;
    }
  }

  return out;
}

function formatDigestLine(item: MemoryItem, maxChars: number): string {
  const kind = item.kind;
  const id = item.memory_item_id;
  const sensitivity = item.sensitivity;
  const prov = formatProvenance(item);
  const header = formatItemHeader(item);

  const base = `- [${kind}] ${id} (${sensitivity}) ${header}`;
  const snippet = itemSnippet(item);
  const suffix = ` (${prov})`;

  const maxLineChars = Math.max(0, Math.floor(maxChars));
  if (maxLineChars === 0) return "";

  const maxSnippetChars = maxLineChars - (base.length + 3 + suffix.length); // " — "
  const safeSnippet =
    snippet && maxSnippetChars > 0 ? truncate(snippet, Math.min(600, maxSnippetChars)) : "";

  const withSnippet =
    safeSnippet.length > 0 ? `${base} — ${safeSnippet}${suffix}` : `${base}${suffix}`;

  if (withSnippet.length <= maxLineChars) return withSnippet;

  // Final fallback: trim entire line to budget.
  return truncate(withSnippet, maxLineChars);
}

export async function buildMemoryV1Digest(params: {
  dal: MemoryV1Dal;
  agentId: string;
  query: string;
  config: AgentConfig["memory"]["v1"];
  semanticSearch?: (query: string, limit: number) => Promise<MemoryV1SemanticSearchHit[]>;
}): Promise<MemoryV1DigestResult> {
  const config = params.config;
  if (!config.enabled) {
    return {
      digest: "Memory digest disabled by config.",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }

  const allowSensitivities = config.allow_sensitivities ?? ["public", "private"];
  const budgets = config.budgets;

  const maxTotalItems = Math.max(0, Math.floor(budgets.max_total_items));
  const maxTotalChars = Math.max(0, Math.floor(budgets.max_total_chars));
  const maxTotalTokens =
    budgets.max_total_tokens !== undefined
      ? Math.max(0, Math.floor(budgets.max_total_tokens))
      : undefined;

  if (
    maxTotalItems === 0 ||
    maxTotalChars === 0 ||
    (maxTotalTokens !== undefined && maxTotalTokens === 0)
  ) {
    // NOTE: tokens budget is optional in config schema but we treat explicit 0 as "nothing".
    const tokensDisabled = maxTotalTokens !== undefined && maxTotalTokens === 0;
    return {
      digest: tokensDisabled
        ? "Memory digest skipped (max_total_tokens=0)."
        : "Memory digest empty.",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }

  const structuredItems = await loadStructuredItems({
    dal: params.dal,
    agentId: params.agentId,
    allow_sensitivities: allowSensitivities,
    structured: config.structured,
    maxItems: Math.max(1, Math.min(200, maxTotalItems * 2)),
  });

  const keywordHits =
    config.keyword.enabled && params.query.trim().length > 0
      ? await params.dal.search(
          {
            v: 1,
            query: params.query,
            limit: config.keyword.limit,
            filter: {
              sensitivities: [...allowSensitivities],
            },
          },
          params.agentId,
        )
      : { v: 1 as const, hits: [], next_cursor: undefined };

  const semanticHits =
    config.semantic.enabled && params.semanticSearch && params.query.trim().length > 0
      ? await params.semanticSearch(params.query, config.semantic.limit)
      : [];

  const candidates: DigestCandidate[] = [];

  for (const item of structuredItems) {
    candidates.push({
      memory_item_id: item.memory_item_id,
      kind: item.kind,
      source: "structured",
      score: Number.POSITIVE_INFINITY,
      item,
    });
  }

  for (const hit of keywordHits.hits) {
    candidates.push({
      memory_item_id: hit.memory_item_id,
      kind: hit.kind,
      source: "keyword",
      score: hit.score,
    });
  }

  const semanticSorted = semanticHits
    .slice()
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.memory_item_id.localeCompare(b.memory_item_id),
    );
  for (const hit of semanticSorted) {
    candidates.push({
      memory_item_id: hit.memory_item_id,
      kind: hit.kind,
      source: "semantic",
      score: hit.score,
    });
  }

  const seen = new Set<string>();
  const includedIds: string[] = [];
  const lines: string[] = [];

  const usedByKind: Record<MemoryItemKind, { items: number; chars: number; tokens: number }> = {
    fact: { items: 0, chars: 0, tokens: 0 },
    note: { items: 0, chars: 0, tokens: 0 },
    procedure: { items: 0, chars: 0, tokens: 0 },
    episode: { items: 0, chars: 0, tokens: 0 },
  };

  let usedTotalItems = 0;
  let usedTotalChars = 0;
  let usedTotalTokens = 0;

  for (const candidate of candidates) {
    if (usedTotalItems >= maxTotalItems) break;
    if (seen.has(candidate.memory_item_id)) continue;

    const kindBudget = resolveKindBudget(budgets.per_kind, candidate.kind);
    const kindUsage = usedByKind[candidate.kind];
    if (!kindUsage) continue;

    if (kindUsage.items >= kindBudget.max_items) continue;
    if (kindUsage.chars >= kindBudget.max_chars) continue;
    if (kindBudget.max_tokens !== undefined && kindUsage.tokens >= kindBudget.max_tokens) continue;

    const item =
      candidate.item ?? (await params.dal.getById(candidate.memory_item_id, params.agentId));
    if (!item) continue;
    if (!sensitivityAllowed(item.sensitivity, allowSensitivities)) continue;

    const remainingTotalChars = maxTotalChars - usedTotalChars;
    const remainingKindChars = kindBudget.max_chars - kindUsage.chars;
    const remainingChars = Math.max(0, Math.min(remainingTotalChars, remainingKindChars));
    if (remainingChars === 0) continue;

    const line = formatDigestLine(item, remainingChars);
    if (!line) continue;

    const tokens = estimateTokens(line);
    const wouldExceedTotalTokens =
      maxTotalTokens !== undefined && usedTotalTokens + tokens > maxTotalTokens;
    const wouldExceedKindTokens =
      kindBudget.max_tokens !== undefined && kindUsage.tokens + tokens > kindBudget.max_tokens;
    if (wouldExceedTotalTokens || wouldExceedKindTokens) {
      // Retry with a more aggressive char limit to reduce tokens deterministically.
      const tightened = formatDigestLine(item, Math.max(1, Math.floor(remainingChars * 0.7)));
      if (!tightened) continue;
      const tightenedTokens = estimateTokens(tightened);
      if (
        (maxTotalTokens !== undefined && usedTotalTokens + tightenedTokens > maxTotalTokens) ||
        (kindBudget.max_tokens !== undefined &&
          kindUsage.tokens + tightenedTokens > kindBudget.max_tokens)
      ) {
        continue;
      }
      lines.push(tightened);
      kindUsage.chars += tightened.length;
      kindUsage.tokens += tightenedTokens;
      kindUsage.items += 1;
      usedTotalChars += tightened.length;
      usedTotalTokens += tightenedTokens;
    } else {
      lines.push(line);
      kindUsage.chars += line.length;
      kindUsage.tokens += tokens;
      kindUsage.items += 1;
      usedTotalChars += line.length;
      usedTotalTokens += tokens;
    }

    usedTotalItems += 1;
    seen.add(candidate.memory_item_id);
    includedIds.push(candidate.memory_item_id);
  }

  const digest = lines.length > 0 ? lines.join("\n") : "No matching durable memory found.";

  return {
    digest,
    included_item_ids: includedIds,
    keyword_hit_count: keywordHits.hits.length,
    semantic_hit_count: semanticHits.length,
    structured_item_count: structuredItems.length,
  };
}
