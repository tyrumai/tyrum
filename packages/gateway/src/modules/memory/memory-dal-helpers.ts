import type {
  BuiltinMemoryServerSettings,
  MemoryItemKind,
  MemorySensitivity,
} from "@tyrum/contracts";
import { irToPlainText, markdownToIr } from "../markdown/ir.js";
import type { MemoryItemFilter, MemoryItemPatch } from "./types.js";
import type {
  Cursor,
  MemoryBudgetLimits,
  MemoryBudgetUsage,
  RawBudgetRow,
} from "./memory-dal-types.js";

export function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export function invalidRequestError(message: string): Error & { code: "invalid_request" } {
  const err = new Error(message) as Error & { code: "invalid_request" };
  err.code = "invalid_request";
  return err;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sort" in parsed &&
      "id" in parsed &&
      typeof (parsed as { sort: unknown }).sort === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return { sort: (parsed as { sort: string }).sort, id: (parsed as { id: string }).id };
    }
  } catch {
    // Intentional: fall through to a generic cursor error for malformed/unknown cursors.
  }
  throw new Error("invalid cursor");
}

export function uniqSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

export function extractSearchTerms(query: string): string[] {
  const matches = query.match(/[%]|[\p{L}\p{N}_-]+/gu) ?? [];
  return uniqSortedStrings(matches.map((term) => term.toLowerCase()));
}

export function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeBudgets(
  budgets: BuiltinMemoryServerSettings["budgets"],
): MemoryBudgetLimits {
  const maxTotalItems = Math.max(0, Math.floor(budgets.max_total_items));
  const maxTotalChars = Math.max(0, Math.floor(budgets.max_total_chars));

  const normalizeKind = (kind: MemoryItemKind): { max_items: number; max_chars: number } => {
    const raw = budgets.per_kind[kind];
    return {
      max_items: Math.max(0, Math.floor(raw.max_items)),
      max_chars: Math.max(0, Math.floor(raw.max_chars)),
    };
  };

  return {
    max_total_items: maxTotalItems,
    max_total_chars: maxTotalChars,
    per_kind: {
      fact: normalizeKind("fact"),
      note: normalizeKind("note"),
      procedure: normalizeKind("procedure"),
      episode: normalizeKind("episode"),
    },
  };
}

export function memoryItemCharCount(row: RawBudgetRow): number {
  if (row.kind === "fact") {
    return (row.key?.length ?? 0) + (row.value_json?.length ?? 0);
  }
  if (row.kind === "note" || row.kind === "procedure") {
    return (row.title?.length ?? 0) + (row.body_md?.length ?? 0);
  }
  return row.summary_md?.length ?? 0;
}

export function computeBudgetUsage(rows: readonly RawBudgetRow[]): MemoryBudgetUsage {
  const usageByKind: MemoryBudgetUsage["per_kind"] = {
    fact: { items: 0, chars: 0 },
    note: { items: 0, chars: 0 },
    procedure: { items: 0, chars: 0 },
    episode: { items: 0, chars: 0 },
  };

  let totalItems = 0;
  let totalChars = 0;

  for (const row of rows) {
    totalItems += 1;
    const chars = memoryItemCharCount(row);
    totalChars += chars;
    const byKind = usageByKind[row.kind];
    byKind.items += 1;
    byKind.chars += chars;
  }

  return { total: { items: totalItems, chars: totalChars }, per_kind: usageByKind };
}

export function overBudget(usage: MemoryBudgetUsage, limits: MemoryBudgetLimits): boolean {
  if (usage.total.items > limits.max_total_items) return true;
  if (usage.total.chars > limits.max_total_chars) return true;
  for (const kind of Object.keys(limits.per_kind) as MemoryItemKind[]) {
    const limit = limits.per_kind[kind];
    const actual = usage.per_kind[kind];
    if (actual.items > limit.max_items) return true;
    if (actual.chars > limit.max_chars) return true;
  }
  return false;
}

export function sensitivityRank(value: MemorySensitivity): number {
  if (value === "public") return 0;
  if (value === "private") return 1;
  return 2;
}

export function normalizeSummaryLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncate(value: string, maxChars: number): string {
  const max = Math.max(0, Math.floor(maxChars));
  if (max === 0) return "";
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return `${value.slice(0, max - 3)}...`;
}

export function buildMemoryItemQueryParts(params: {
  tenantId: string;
  agentId: string;
  filter?: MemoryItemFilter;
  limit?: number;
  cursor?: string;
  extraWhere?: string[];
  extraValues?: readonly unknown[];
  alwaysJoinProvenance?: boolean;
}): { from: string; where: string[]; values: unknown[]; limit: number } {
  const where: string[] = ["i.tenant_id = ?", "i.agent_id = ?"];
  const values: unknown[] = [params.tenantId, params.agentId];

  const filter = params.filter;

  if (filter?.kinds && filter.kinds.length > 0) {
    const kinds = [...new Set(filter.kinds)];
    where.push(`i.kind IN (${kinds.map(() => "?").join(", ")})`);
    values.push(...kinds);
  }

  if (filter?.sensitivities && filter.sensitivities.length > 0) {
    const sensitivities = [...new Set(filter.sensitivities)];
    where.push(`i.sensitivity IN (${sensitivities.map(() => "?").join(", ")})`);
    values.push(...sensitivities);
  }

  if (filter?.keys && filter.keys.length > 0) {
    const keys = uniqSortedStrings(filter.keys);
    if (keys.length > 0) {
      where.push(`i.key IN (${keys.map(() => "?").join(", ")})`);
      values.push(...keys);
    }
  }

  if (filter?.tags && filter.tags.length > 0) {
    const tags = uniqSortedStrings(filter.tags);
    if (tags.length > 0) {
      where.push(
        `i.memory_item_id IN (
           SELECT t.memory_item_id
           FROM memory_item_tags t
           WHERE t.tenant_id = ?
             AND t.agent_id = ?
             AND t.tag IN (${tags.map(() => "?").join(", ")})
         )`,
      );
      values.push(params.tenantId, params.agentId, ...tags);
    }
  }

  const provenanceFilter = filter?.provenance;
  const provenanceSourceKinds =
    provenanceFilter?.source_kinds && provenanceFilter.source_kinds.length > 0
      ? [...new Set(provenanceFilter.source_kinds)]
      : [];
  const provenanceChannels =
    provenanceFilter?.channels && provenanceFilter.channels.length > 0
      ? uniqSortedStrings(provenanceFilter.channels)
      : [];
  const provenanceThreadIds =
    provenanceFilter?.thread_ids && provenanceFilter.thread_ids.length > 0
      ? uniqSortedStrings(provenanceFilter.thread_ids)
      : [];
  const provenanceSessionIds =
    provenanceFilter?.session_ids && provenanceFilter.session_ids.length > 0
      ? uniqSortedStrings(provenanceFilter.session_ids)
      : [];
  const joinProvenance =
    params.alwaysJoinProvenance === true ||
    Boolean(
      provenanceFilter &&
      (provenanceSourceKinds.length > 0 ||
        provenanceChannels.length > 0 ||
        provenanceThreadIds.length > 0 ||
        provenanceSessionIds.length > 0),
    );

  if (joinProvenance) {
    if (provenanceSourceKinds.length > 0) {
      where.push(`p.source_kind IN (${provenanceSourceKinds.map(() => "?").join(", ")})`);
      values.push(...provenanceSourceKinds);
    }
    if (provenanceChannels.length > 0) {
      where.push(`p.channel IN (${provenanceChannels.map(() => "?").join(", ")})`);
      values.push(...provenanceChannels);
    }
    if (provenanceThreadIds.length > 0) {
      where.push(`p.thread_id IN (${provenanceThreadIds.map(() => "?").join(", ")})`);
      values.push(...provenanceThreadIds);
    }
    if (provenanceSessionIds.length > 0) {
      where.push(`p.session_id IN (${provenanceSessionIds.map(() => "?").join(", ")})`);
      values.push(...provenanceSessionIds);
    }
  }

  if (params.extraWhere && params.extraWhere.length > 0) {
    where.push(...params.extraWhere);
    if (params.extraValues && params.extraValues.length > 0) {
      values.push(...params.extraValues);
    }
  }

  if (params.cursor) {
    const cursor = decodeCursor(params.cursor);
    where.push("(i.created_at < ? OR (i.created_at = ? AND i.memory_item_id < ?))");
    values.push(cursor.sort, cursor.sort, cursor.id);
  }

  const limit = Math.max(1, Math.min(500, params.limit ?? 50));

  const from = joinProvenance
    ? `memory_items i
       JOIN memory_item_provenance p
         ON p.tenant_id = i.tenant_id
        AND p.agent_id = i.agent_id
        AND p.memory_item_id = i.memory_item_id`
    : "memory_items i";

  return { from, where, values, limit };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeSnippet(value: string): string {
  let sanitized = value;

  sanitized = sanitized.replace(/\b(system|developer|assistant)\s*:/gi, "[role-ref] $1:");
  sanitized = sanitized.replace(
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  );
  sanitized = sanitized.replace(
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  );
  sanitized = sanitized.replace(
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  );
  sanitized = sanitized.replace(/you\s+are\s+now\b/gi, "[blocked-reidentity]");
  sanitized = sanitized.replace(
    /\b(new|updated|revised|override)\s+instructions?\s*:/gi,
    "[blocked-header]",
  );
  sanitized = sanitized.replace(
    /(do\s+not|don'?t|stop)\s+follow(ing)?\s+(the\s+)?(system|previous|original)/gi,
    "[blocked-directive]",
  );
  sanitized = sanitized.replace(
    /\b(show|print|display|output|reveal|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)\b/gi,
    "[blocked-extraction]",
  );

  return sanitized;
}

function clampSnippet(value: string, maxChars: number): string {
  const max = Math.max(1, Math.floor(maxChars));
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, max - 1)}…`;
}

export function buildSnippet(
  text: string,
  terms: readonly string[],
  maxChars: number,
): string | undefined {
  const cleaned = collapseWhitespace(text);
  if (cleaned.length === 0) return undefined;

  const max = Math.max(1, Math.floor(maxChars));
  if (cleaned.length <= max) {
    return clampSnippet(sanitizeSnippet(cleaned), max);
  }

  if (terms.length === 0) {
    return clampSnippet(sanitizeSnippet(`${cleaned.slice(0, max - 1)}…`), max);
  }

  const lower = cleaned.toLowerCase();
  let bestIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
      bestIdx = idx;
    }
  }

  const focus = bestIdx >= 0 ? bestIdx : 0;
  let window = max;
  let start = 0;
  let end = 0;
  let needsLeading = false;
  let needsTrailing = false;
  for (let i = 0; i < 3; i += 1) {
    start = Math.max(0, focus - Math.floor(window / 3));
    end = Math.min(cleaned.length, start + window);
    if (end === cleaned.length) {
      start = Math.max(0, end - window);
    }

    needsLeading = start > 0;
    needsTrailing = end < cleaned.length;

    const ellipses = (needsLeading ? 1 : 0) + (needsTrailing ? 1 : 0);
    const nextWindow = Math.max(1, max - ellipses);
    if (nextWindow === window) break;
    window = nextWindow;
  }

  let snippet = cleaned.slice(start, end);
  if (needsLeading) snippet = `…${snippet}`;
  if (needsTrailing) snippet = `${snippet}…`;
  return clampSnippet(sanitizeSnippet(snippet), max);
}

export function markdownToPlainText(value: string): string {
  try {
    return irToPlainText(markdownToIr(value));
  } catch {
    // Intentional: treat markdown parsing failures as plain text.
    return value;
  }
}

export function assertPatchCompatible(kind: MemoryItemKind, patch: MemoryItemPatch): void {
  const incompatible: string[] = [];

  const isSet = (value: unknown): boolean => value !== undefined;

  const allowedCommon: readonly (keyof MemoryItemPatch)[] = ["tags", "sensitivity", "provenance"];
  const allowedKindSpecific: readonly (keyof MemoryItemPatch)[] =
    kind === "fact"
      ? ["key", "value", "observed_at", "confidence"]
      : kind === "note"
        ? ["title", "body_md"]
        : kind === "procedure"
          ? ["title", "body_md", "confidence"]
          : ["occurred_at", "summary_md"];

  const allowed = new Set<keyof MemoryItemPatch>([...allowedCommon, ...allowedKindSpecific]);

  const allFields: readonly (keyof MemoryItemPatch)[] = [
    "tags",
    "sensitivity",
    "provenance",
    "key",
    "value",
    "title",
    "body_md",
    "summary_md",
    "confidence",
    "observed_at",
    "occurred_at",
  ];

  for (const field of allFields) {
    if (allowed.has(field)) continue;
    if (isSet(patch[field])) incompatible.push(String(field));
  }

  if (incompatible.length > 0) {
    throw new Error(`incompatible patch fields for kind=${kind}: ${incompatible.join(", ")}`);
  }
}
