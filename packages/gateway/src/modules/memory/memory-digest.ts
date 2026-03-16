import type { BuiltinMemoryServerSettings, MemoryItem, MemoryItemKind } from "@tyrum/schemas";
import { normalizeSnippet, truncate } from "./memory-dal-helpers.js";
import type { MemorySemanticSearchHit } from "./memory-semantic-index.js";
import type { MemoryDal } from "./memory-dal.js";
import { retrieveMemory } from "./memory-retrieval.js";

export type MemoryDigestResult = {
  digest: string;
  included_item_ids: string[];
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
};

function estimateTokens(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
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
      // Intentional: fall back to string coercion for non-JSON-serializable fact values.
      value = String(item.value);
    }
    return `key=${item.key} value=${truncate(value, 240)} conf=${item.confidence.toFixed(2)}`;
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

  return `occurred_at=${normalizeSnippet(item.occurred_at)}`;
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
  config: BuiltinMemoryServerSettings["budgets"]["per_kind"],
  kind: MemoryItemKind,
): { max_items: number; max_chars: number; max_tokens?: number } {
  const budget = config[kind];
  return {
    max_items: Math.max(0, Math.floor(budget.max_items)),
    max_chars: Math.max(0, Math.floor(budget.max_chars)),
    ...(budget.max_tokens !== undefined
      ? { max_tokens: Math.max(0, Math.floor(budget.max_tokens)) }
      : {}),
  };
}

function formatDigestLine(item: MemoryItem, maxChars: number): string {
  const base = `- [${item.kind}] ${item.memory_item_id} (${item.sensitivity}) ${formatItemHeader(item)}`;
  const snippet = itemSnippet(item);
  const suffix = ` (${formatProvenance(item)})`;
  const maxLineChars = Math.max(0, Math.floor(maxChars));
  if (maxLineChars === 0) return "";

  const maxSnippetChars = maxLineChars - (base.length + 3 + suffix.length);
  const safeSnippet =
    snippet && maxSnippetChars > 0 ? truncate(snippet, Math.min(600, maxSnippetChars)) : "";
  const line = safeSnippet.length > 0 ? `${base} — ${safeSnippet}${suffix}` : `${base}${suffix}`;
  return line.length <= maxLineChars ? line : truncate(line, maxLineChars);
}

export async function buildMemoryDigest(params: {
  dal: MemoryDal;
  tenantId: string;
  agentId: string;
  query: string;
  config: BuiltinMemoryServerSettings;
  semanticSearch?: (query: string, limit: number) => Promise<MemorySemanticSearchHit[]>;
}): Promise<MemoryDigestResult> {
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
  if (allowSensitivities.length === 0) {
    return {
      digest: "Memory digest empty (no allowed sensitivities).",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }

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
    return {
      digest:
        maxTotalTokens !== undefined && maxTotalTokens === 0
          ? "Memory digest skipped (max_total_tokens=0)."
          : "Memory digest empty.",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }

  const query = params.query.trim();
  const retrieval = await (async () => {
    try {
      return await retrieveMemory({
        dal: params.dal,
        tenantId: params.tenantId,
        agentId: params.agentId,
        query,
        allow_sensitivities: allowSensitivities,
        structured: config.structured,
        structuredMaxItems: Math.max(1, Math.min(200, maxTotalItems * 2)),
        keywordLimit: config.keyword.enabled && query.length > 0 ? config.keyword.limit : 0,
        semanticLimit: config.semantic.enabled && query.length > 0 ? config.semantic.limit : 0,
        semanticSearch:
          config.semantic.enabled && params.semanticSearch ? params.semanticSearch : undefined,
      });
    } catch {
      // Intentional: digest construction is best-effort and should degrade to an empty result.
      return {
        hits: [],
        keyword_hit_count: 0,
        semantic_hit_count: 0,
        structured_item_count: 0,
      };
    }
  })();

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

  for (const hit of retrieval.hits) {
    if (usedTotalItems >= maxTotalItems) break;

    const item = hit.item;
    const kindBudget = resolveKindBudget(budgets.per_kind, item.kind);
    const kindUsage = usedByKind[item.kind];
    if (kindUsage.items >= kindBudget.max_items) continue;
    if (kindUsage.chars >= kindBudget.max_chars) continue;
    if (kindBudget.max_tokens !== undefined && kindUsage.tokens >= kindBudget.max_tokens) continue;

    const separatorChars = lines.length > 0 ? 1 : 0;
    const remainingTotalChars = maxTotalChars - usedTotalChars - separatorChars;
    const remainingKindChars = kindBudget.max_chars - kindUsage.chars - separatorChars;
    const remainingChars = Math.max(0, Math.min(remainingTotalChars, remainingKindChars));
    if (remainingChars === 0) continue;

    const line = formatDigestLine(item, remainingChars);
    if (!line) continue;

    let chosenLine = line;
    let chosenTokens = estimateTokens(line);
    const exceedsTotalTokens =
      maxTotalTokens !== undefined && usedTotalTokens + chosenTokens > maxTotalTokens;
    const exceedsKindTokens =
      kindBudget.max_tokens !== undefined &&
      kindUsage.tokens + chosenTokens > kindBudget.max_tokens;

    if (exceedsTotalTokens || exceedsKindTokens) {
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
      chosenLine = tightened;
      chosenTokens = tightenedTokens;
    }

    lines.push(chosenLine);
    kindUsage.chars += separatorChars + chosenLine.length;
    kindUsage.tokens += chosenTokens;
    kindUsage.items += 1;
    usedTotalChars += separatorChars + chosenLine.length;
    usedTotalTokens += chosenTokens;
    usedTotalItems += 1;
    includedIds.push(item.memory_item_id);
  }

  return {
    digest: lines.length > 0 ? lines.join("\n") : "No matching durable memory found.",
    included_item_ids: includedIds,
    keyword_hit_count: retrieval.keyword_hit_count,
    semantic_hit_count: retrieval.semantic_hit_count,
    structured_item_count: retrieval.structured_item_count,
  };
}
