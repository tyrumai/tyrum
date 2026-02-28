import { randomUUID } from "node:crypto";
import type {
  AgentConfig,
  MemoryDeletedBy,
  MemoryForgetSelector,
  MemoryItemFilter,
  MemoryItem,
  MemoryItemCreateInput,
  MemoryItemKind,
  MemoryItemPatch,
  MemoryProvenance,
  MemorySensitivity,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryTombstone,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { irToPlainText, markdownToIr } from "../markdown/ir.js";

interface RawMemoryItemRow {
  memory_item_id: string;
  agent_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  key: string | null;
  value_json: string | null;
  observed_at: string | null;
  title: string | null;
  body_md: string | null;
  occurred_at: string | null;
  summary_md: string | null;
  confidence: number | null;
  created_at: string | Date;
  updated_at: string | Date | null;
}

interface RawProvenanceRow {
  memory_item_id: string;
  agent_id: string;
  source_kind: MemoryProvenance["source_kind"];
  channel: string | null;
  thread_id: string | null;
  session_id: string | null;
  message_id: string | null;
  tool_call_id: string | null;
  refs_json: string;
  metadata_json: string | null;
}

interface RawTagRow {
  tag: string;
}

interface RawTombstoneRow {
  memory_item_id: string;
  agent_id: string;
  deleted_at: string | Date;
  deleted_by: MemoryDeletedBy;
  reason: string | null;
}

interface RawSearchRow {
  memory_item_id: string;
  kind: MemoryItemKind;
  key: string | null;
  title: string | null;
  body_md: string | null;
  summary_md: string | null;
  created_at: string | Date;
  source_kind: MemoryProvenance["source_kind"];
  channel: string | null;
  thread_id: string | null;
  session_id: string | null;
  message_id: string | null;
  tool_call_id: string | null;
  refs_json: string;
  metadata_json: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function invalidRequestError(message: string): Error & { code: "invalid_request" } {
  const err = new Error(message) as Error & { code: "invalid_request" };
  err.code = "invalid_request";
  return err;
}

type Cursor = { sort: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

function decodeCursor(raw: string): Cursor {
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
    // fall through
  }
  throw new Error("invalid cursor");
}

function uniqSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].sort();
}

type MemoryV1BudgetLimits = {
  max_total_items: number;
  max_total_chars: number;
  per_kind: Record<MemoryItemKind, { max_items: number; max_chars: number }>;
};

type MemoryV1BudgetUsage = {
  total: { items: number; chars: number };
  per_kind: Record<MemoryItemKind, { items: number; chars: number }>;
};

export type MemoryV1ConsolidationResult = {
  ran: boolean;
  created_items: MemoryItem[];
  deleted_tombstones: MemoryTombstone[];
  dropped_derived_indexes: { deleted_vectors: number; deleted_links: number };
  before: MemoryV1BudgetUsage;
  after: MemoryV1BudgetUsage;
};

type RawBudgetRow = {
  memory_item_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  key: string | null;
  value_json: string | null;
  observed_at: string | null;
  title: string | null;
  body_md: string | null;
  occurred_at: string | null;
  summary_md: string | null;
  confidence: number | null;
  created_at: string | Date;
};

function normalizeBudgets(budgets: AgentConfig["memory"]["v1"]["budgets"]): MemoryV1BudgetLimits {
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

function memoryItemCharCount(row: RawBudgetRow): number {
  if (row.kind === "fact") {
    return (row.key?.length ?? 0) + (row.value_json?.length ?? 0);
  }
  if (row.kind === "note" || row.kind === "procedure") {
    return (row.title?.length ?? 0) + (row.body_md?.length ?? 0);
  }
  return row.summary_md?.length ?? 0;
}

function computeBudgetUsage(rows: readonly RawBudgetRow[]): MemoryV1BudgetUsage {
  const usageByKind: MemoryV1BudgetUsage["per_kind"] = {
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

function overBudget(usage: MemoryV1BudgetUsage, limits: MemoryV1BudgetLimits): boolean {
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

function normalizeSummaryLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  const max = Math.max(0, Math.floor(maxChars));
  if (max === 0) return "";
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return `${value.slice(0, max - 3)}...`;
}

export function buildMemoryV1ItemQueryParts(params: {
  agent: string;
  filter?: MemoryItemFilter;
  limit?: number;
  cursor?: string;
  extraWhere?: string[];
  extraValues?: readonly unknown[];
  alwaysJoinProvenance?: boolean;
}): { from: string; where: string[]; values: unknown[]; limit: number } {
  const where: string[] = ["i.agent_id = ?"];
  const values: unknown[] = [params.agent];

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
           WHERE t.agent_id = ?
             AND t.tag IN (${tags.map(() => "?").join(", ")})
         )`,
      );
      values.push(params.agent, ...tags);
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
         ON p.agent_id = i.agent_id AND p.memory_item_id = i.memory_item_id`
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

function buildSnippet(
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

function markdownToPlainText(value: string): string {
  try {
    return irToPlainText(markdownToIr(value));
  } catch {
    return value;
  }
}

function assertPatchCompatible(kind: MemoryItemKind, patch: MemoryItemPatch): void {
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

export class MemoryV1Dal {
  constructor(private readonly db: SqlDb) {}

  private normalizeAgentId(agentId?: string): string {
    const trimmed = agentId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "default";
  }

  private async resolveSelectorIds(
    selector: MemoryForgetSelector,
    agentId: string,
  ): Promise<string[]> {
    if (selector.kind === "id") {
      return [selector.memory_item_id];
    }

    if (selector.kind === "key") {
      const where: string[] = ["agent_id = ?", "key = ?"];
      const values: unknown[] = [agentId, selector.key];

      if (selector.item_kind) {
        where.push("kind = ?");
        values.push(selector.item_kind);
      }

      const rows = await this.db.all<{ memory_item_id: string }>(
        `SELECT memory_item_id
         FROM memory_items
         WHERE ${where.join(" AND ")}`,
        values,
      );
      return rows.map((r) => r.memory_item_id);
    }

    if (selector.kind === "tag") {
      const rows = await this.db.all<{ memory_item_id: string }>(
        `SELECT DISTINCT memory_item_id
         FROM memory_item_tags
         WHERE agent_id = ? AND tag = ?`,
        [agentId, selector.tag],
      );
      return rows.map((r) => r.memory_item_id);
    }

    const provenance = selector.provenance;
    const where: string[] = ["agent_id = ?"];
    const values: unknown[] = [agentId];

    if (provenance.source_kind !== undefined) {
      where.push("source_kind = ?");
      values.push(provenance.source_kind);
    }
    if (provenance.channel !== undefined) {
      where.push("channel = ?");
      values.push(provenance.channel);
    }
    if (provenance.thread_id !== undefined) {
      where.push("thread_id = ?");
      values.push(provenance.thread_id);
    }
    if (provenance.session_id !== undefined) {
      where.push("session_id = ?");
      values.push(provenance.session_id);
    }
    if (provenance.message_id !== undefined) {
      where.push("message_id = ?");
      values.push(provenance.message_id);
    }
    if (provenance.tool_call_id !== undefined) {
      where.push("tool_call_id = ?");
      values.push(provenance.tool_call_id);
    }

    const rows = await this.db.all<{ memory_item_id: string }>(
      `SELECT memory_item_id
       FROM memory_item_provenance
       WHERE ${where.join(" AND ")}`,
      values,
    );
    return rows.map((r) => r.memory_item_id);
  }

  async list(params: {
    filter?: MemoryItemFilter;
    limit?: number;
    cursor?: string;
    agentId?: string;
  }): Promise<{ items: MemoryItem[]; next_cursor?: string }> {
    const agent = this.normalizeAgentId(params.agentId);

    const { from, where, values, limit } = buildMemoryV1ItemQueryParts({
      agent,
      filter: params.filter,
      limit: params.limit,
      cursor: params.cursor,
    });

    const rows = await this.db.all<{ memory_item_id: string; created_at: string | Date }>(
      `SELECT i.memory_item_id AS memory_item_id, i.created_at AS created_at
       FROM ${from}
       WHERE ${where.join(" AND ")}
       ORDER BY i.created_at DESC, i.memory_item_id DESC
       LIMIT ?`,
      [...values, limit],
    );

    const items: MemoryItem[] = [];
    for (const row of rows) {
      const item = await this.getById(row.memory_item_id, agent);
      if (item) items.push(item);
    }

    const last = rows.at(-1);
    const next_cursor =
      rows.length === limit && last
        ? encodeCursor({ sort: normalizeTime(last.created_at), id: last.memory_item_id })
        : undefined;

    return { items, next_cursor };
  }

  async forget(params: {
    selectors: MemoryForgetSelector[];
    deleted_by: MemoryDeletedBy;
    reason?: string;
    agentId?: string;
  }): Promise<{ deleted_count: number; tombstones: MemoryTombstone[] }> {
    const agent = this.normalizeAgentId(params.agentId);

    const ids = new Set<string>();
    for (const selector of params.selectors) {
      const matched = await this.resolveSelectorIds(selector, agent);
      for (const id of matched) ids.add(id);
    }

    const tombstones: MemoryTombstone[] = [];
    for (const id of ids) {
      try {
        const tombstone = await this.delete(
          id,
          { deleted_by: params.deleted_by, reason: params.reason },
          agent,
        );
        tombstones.push(tombstone);
      } catch (err) {
        if (err instanceof Error && err.message === "memory item not found") {
          continue;
        }
        throw err;
      }
    }

    return { deleted_count: tombstones.length, tombstones };
  }

  async listTombstones(params: {
    limit?: number;
    cursor?: string;
    agentId?: string;
  }): Promise<{ tombstones: MemoryTombstone[]; next_cursor?: string }> {
    const agent = this.normalizeAgentId(params.agentId);

    const where: string[] = ["agent_id = ?"];
    const values: unknown[] = [agent];

    if (params.cursor) {
      const cursor = decodeCursor(params.cursor);
      where.push("(deleted_at < ? OR (deleted_at = ? AND memory_item_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(500, params.limit ?? 50));

    const rows = await this.db.all<RawTombstoneRow>(
      `SELECT *
       FROM memory_tombstones
       WHERE ${where.join(" AND ")}
       ORDER BY deleted_at DESC, memory_item_id DESC
       LIMIT ?`,
      [...values, limit],
    );

    const tombstones: MemoryTombstone[] = rows.map((r) => ({
      v: 1,
      memory_item_id: r.memory_item_id,
      agent_id: r.agent_id,
      deleted_at: normalizeTime(r.deleted_at),
      deleted_by: r.deleted_by,
      ...(r.reason ? { reason: r.reason } : {}),
    }));

    const last = rows.at(-1);
    const next_cursor =
      rows.length === limit && last
        ? encodeCursor({ sort: normalizeTime(last.deleted_at), id: last.memory_item_id })
        : undefined;

    return { tombstones, next_cursor };
  }

  async create(input: MemoryItemCreateInput, agentId?: string): Promise<MemoryItem> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();
    const memoryItemId = randomUUID();

    const tags = uniqSortedStrings(input.tags ?? []);
    const sensitivity = input.sensitivity ?? "private";

    const baseParams = {
      memory_item_id: memoryItemId,
      agent_id: agent,
      kind: input.kind,
      sensitivity,
      created_at: nowIso,
    } as const;

    await this.db.transaction(async (tx) => {
      switch (input.kind) {
        case "fact": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               key, value_json, observed_at, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.key,
              JSON.stringify(input.value),
              input.observed_at,
              input.confidence,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "note": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               title, body_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.title ?? null,
              input.body_md,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "procedure": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               title, body_md, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.title ?? null,
              input.body_md,
              input.confidence ?? null,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "episode": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               occurred_at, summary_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.occurred_at,
              input.summary_md,
              baseParams.created_at,
            ],
          );
          break;
        }
      }

      await tx.run(
        `INSERT INTO memory_item_provenance (
           memory_item_id,
           agent_id,
           source_kind,
           channel,
           thread_id,
           session_id,
           message_id,
           tool_call_id,
           refs_json,
           metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryItemId,
          agent,
          input.provenance.source_kind,
          input.provenance.channel ?? null,
          input.provenance.thread_id ?? null,
          input.provenance.session_id ?? null,
          input.provenance.message_id ?? null,
          input.provenance.tool_call_id ?? null,
          JSON.stringify(input.provenance.refs ?? []),
          input.provenance.metadata !== undefined
            ? JSON.stringify(input.provenance.metadata)
            : null,
        ],
      );

      for (const tag of tags) {
        await tx.run(
          `INSERT INTO memory_item_tags (agent_id, memory_item_id, tag)
           VALUES (?, ?, ?)
           ON CONFLICT(agent_id, memory_item_id, tag) DO NOTHING`,
          [agent, memoryItemId, tag],
        );
      }
    });

    const created = await this.getById(memoryItemId, agent);
    if (!created) throw new Error("failed to read created memory item");
    return created;
  }

  async getById(memoryItemId: string, agentId?: string): Promise<MemoryItem | undefined> {
    const agent = this.normalizeAgentId(agentId);

    const item = await this.db.get<RawMemoryItemRow>(
      `SELECT *
       FROM memory_items
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
    );
    if (!item) return undefined;

    const provenanceRow = await this.db.get<RawProvenanceRow>(
      `SELECT *
       FROM memory_item_provenance
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
    );
    if (!provenanceRow) {
      throw new Error(`missing provenance row for memory_item_id=${memoryItemId}`);
    }

    const tagRows = await this.db.all<RawTagRow>(
      `SELECT tag
       FROM memory_item_tags
       WHERE agent_id = ? AND memory_item_id = ?
       ORDER BY tag ASC`,
      [agent, memoryItemId],
    );

    const provenance: MemoryProvenance = {
      source_kind: provenanceRow.source_kind,
      ...(provenanceRow.channel ? { channel: provenanceRow.channel } : {}),
      ...(provenanceRow.thread_id ? { thread_id: provenanceRow.thread_id } : {}),
      ...(provenanceRow.session_id ? { session_id: provenanceRow.session_id } : {}),
      ...(provenanceRow.message_id ? { message_id: provenanceRow.message_id } : {}),
      ...(provenanceRow.tool_call_id ? { tool_call_id: provenanceRow.tool_call_id } : {}),
      refs: parseJson<string[]>(provenanceRow.refs_json),
      ...(provenanceRow.metadata_json
        ? { metadata: parseJson<unknown>(provenanceRow.metadata_json) }
        : {}),
    };

    const base = {
      v: 1 as const,
      memory_item_id: item.memory_item_id,
      agent_id: item.agent_id,
      kind: item.kind,
      tags: tagRows.map((r) => r.tag),
      sensitivity: item.sensitivity,
      provenance,
      created_at: normalizeTime(item.created_at),
      ...(item.updated_at ? { updated_at: normalizeTime(item.updated_at) } : {}),
    };

    switch (item.kind) {
      case "fact": {
        if (
          !item.key ||
          item.value_json === null ||
          !item.observed_at ||
          item.confidence === null
        ) {
          throw new Error(`invalid fact row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "fact",
          key: item.key,
          value: parseJson<unknown>(item.value_json),
          observed_at: item.observed_at,
          confidence: item.confidence,
        };
      }
      case "note": {
        if (!item.body_md) throw new Error(`invalid note row for memory_item_id=${memoryItemId}`);
        return {
          ...base,
          kind: "note",
          ...(item.title ? { title: item.title } : {}),
          body_md: item.body_md,
        };
      }
      case "procedure": {
        if (!item.body_md) {
          throw new Error(`invalid procedure row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "procedure",
          ...(item.title ? { title: item.title } : {}),
          body_md: item.body_md,
          ...(item.confidence !== null ? { confidence: item.confidence } : {}),
        };
      }
      case "episode": {
        if (!item.occurred_at || !item.summary_md) {
          throw new Error(`invalid episode row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "episode",
          occurred_at: item.occurred_at,
          summary_md: item.summary_md,
        };
      }
    }
  }

  async update(
    memoryItemId: string,
    patch: MemoryItemPatch,
    agentId?: string,
  ): Promise<MemoryItem> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      const existing = await tx.get<Pick<RawMemoryItemRow, "kind">>(
        `SELECT kind
         FROM memory_items
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (!existing) throw new Error("memory item not found");

      assertPatchCompatible(existing.kind, patch);

      const updates: string[] = ["updated_at = ?"];
      const params: unknown[] = [nowIso];

      if (patch.sensitivity !== undefined) {
        updates.push("sensitivity = ?");
        params.push(patch.sensitivity);
      }

      switch (existing.kind) {
        case "fact": {
          if (patch.key !== undefined) {
            updates.push("key = ?");
            params.push(patch.key);
          }
          if (patch.value !== undefined) {
            updates.push("value_json = ?");
            params.push(JSON.stringify(patch.value));
          }
          if (patch.observed_at !== undefined) {
            updates.push("observed_at = ?");
            params.push(patch.observed_at);
          }
          if (patch.confidence !== undefined) {
            updates.push("confidence = ?");
            params.push(patch.confidence);
          }
          break;
        }
        case "note": {
          if (patch.title !== undefined) {
            updates.push("title = ?");
            params.push(patch.title);
          }
          if (patch.body_md !== undefined) {
            updates.push("body_md = ?");
            params.push(patch.body_md);
          }
          break;
        }
        case "procedure": {
          if (patch.title !== undefined) {
            updates.push("title = ?");
            params.push(patch.title);
          }
          if (patch.body_md !== undefined) {
            updates.push("body_md = ?");
            params.push(patch.body_md);
          }
          if (patch.confidence !== undefined) {
            updates.push("confidence = ?");
            params.push(patch.confidence);
          }
          break;
        }
        case "episode": {
          if (patch.occurred_at !== undefined) {
            updates.push("occurred_at = ?");
            params.push(patch.occurred_at);
          }
          if (patch.summary_md !== undefined) {
            updates.push("summary_md = ?");
            params.push(patch.summary_md);
          }
          break;
        }
      }

      params.push(agent, memoryItemId);
      await tx.run(
        `UPDATE memory_items
         SET ${updates.join(", ")}
         WHERE agent_id = ? AND memory_item_id = ?`,
        params,
      );

      if (patch.provenance !== undefined) {
        await tx.run(
          `UPDATE memory_item_provenance
           SET source_kind = ?,
               channel = ?,
               thread_id = ?,
               session_id = ?,
               message_id = ?,
               tool_call_id = ?,
               refs_json = ?,
               metadata_json = ?
           WHERE agent_id = ? AND memory_item_id = ?`,
          [
            patch.provenance.source_kind,
            patch.provenance.channel ?? null,
            patch.provenance.thread_id ?? null,
            patch.provenance.session_id ?? null,
            patch.provenance.message_id ?? null,
            patch.provenance.tool_call_id ?? null,
            JSON.stringify(patch.provenance.refs ?? []),
            patch.provenance.metadata !== undefined
              ? JSON.stringify(patch.provenance.metadata)
              : null,
            agent,
            memoryItemId,
          ],
        );
      }

      if (patch.tags !== undefined) {
        const tags = uniqSortedStrings(patch.tags);
        await tx.run(
          `DELETE FROM memory_item_tags
           WHERE agent_id = ? AND memory_item_id = ?`,
          [agent, memoryItemId],
        );
        for (const tag of tags) {
          await tx.run(
            `INSERT INTO memory_item_tags (agent_id, memory_item_id, tag)
             VALUES (?, ?, ?)
             ON CONFLICT(agent_id, memory_item_id, tag) DO NOTHING`,
            [agent, memoryItemId, tag],
          );
        }
      }
    });

    const updated = await this.getById(memoryItemId, agent);
    if (!updated) throw new Error("failed to read updated memory item");
    return updated;
  }

  async search(input: MemorySearchRequest, agentId?: string): Promise<MemorySearchResponse> {
    const agent = this.normalizeAgentId(agentId);

    const query = input.query.trim();
    if (query.length === 0) {
      return { v: 1, hits: [], next_cursor: undefined };
    }

    const MAX_QUERY_CHARS = 1024;
    const MAX_TERMS = 12;
    const MAX_TERM_CHARS = 64;
    const MAX_FILTER_KEYS = 50;
    const MAX_FILTER_TAGS = 20;
    const MAX_FILTER_PROVENANCE_VALUES = 20;
    const MAX_CANDIDATE_LIMIT = 1000;
    const MAX_SQL_PARAMS = 900;

    if (query !== "*" && query.length > MAX_QUERY_CHARS) {
      throw invalidRequestError(`query too long (max=${MAX_QUERY_CHARS})`);
    }

    const rawTerms =
      query === "*"
        ? []
        : query
            .split(/\s+/g)
            .map((term) => term.trim())
            .filter(Boolean);
    if (rawTerms.some((term) => term.length > MAX_TERM_CHARS)) {
      throw invalidRequestError(`query term too long (max=${MAX_TERM_CHARS})`);
    }

    const terms = uniqSortedStrings(rawTerms.map((term) => term.toLowerCase()));

    if (terms.length > MAX_TERMS) {
      throw invalidRequestError(`too many query terms (max=${MAX_TERMS})`);
    }

    const limit = Math.max(1, Math.min(500, input.limit ?? 20));
    const candidateLimit = Math.min(Math.max(limit * 20, 200), MAX_CANDIDATE_LIMIT);

    const filter = input.filter;
    let normalizedFilter: MemoryItemFilter | undefined;
    if (filter) {
      const next: MemoryItemFilter = {};
      if (filter.kinds && filter.kinds.length > 0) next.kinds = [...new Set(filter.kinds)];
      if (filter.sensitivities && filter.sensitivities.length > 0) {
        next.sensitivities = [...new Set(filter.sensitivities)];
      }

      if (filter.keys && filter.keys.length > 0) {
        const keys = uniqSortedStrings(filter.keys);
        if (keys.length > MAX_FILTER_KEYS) {
          throw invalidRequestError(`too many filter.keys (max=${MAX_FILTER_KEYS})`);
        }
        if (keys.length > 0) next.keys = keys;
      }

      if (filter.tags && filter.tags.length > 0) {
        const tags = uniqSortedStrings(filter.tags);
        if (tags.length > MAX_FILTER_TAGS) {
          throw invalidRequestError(`too many filter.tags (max=${MAX_FILTER_TAGS})`);
        }
        if (tags.length > 0) next.tags = tags;
      }

      if (filter.provenance) {
        const provenance: NonNullable<MemoryItemFilter["provenance"]> = {};
        if (filter.provenance.source_kinds && filter.provenance.source_kinds.length > 0) {
          provenance.source_kinds = [...new Set(filter.provenance.source_kinds)];
        }
        if (filter.provenance.channels && filter.provenance.channels.length > 0) {
          const channels = uniqSortedStrings(filter.provenance.channels);
          if (channels.length > MAX_FILTER_PROVENANCE_VALUES) {
            throw invalidRequestError(
              `too many filter.provenance.channels (max=${MAX_FILTER_PROVENANCE_VALUES})`,
            );
          }
          if (channels.length > 0) provenance.channels = channels;
        }
        if (filter.provenance.thread_ids && filter.provenance.thread_ids.length > 0) {
          const threadIds = uniqSortedStrings(filter.provenance.thread_ids);
          if (threadIds.length > MAX_FILTER_PROVENANCE_VALUES) {
            throw invalidRequestError(
              `too many filter.provenance.thread_ids (max=${MAX_FILTER_PROVENANCE_VALUES})`,
            );
          }
          if (threadIds.length > 0) provenance.thread_ids = threadIds;
        }
        if (filter.provenance.session_ids && filter.provenance.session_ids.length > 0) {
          const sessionIds = uniqSortedStrings(filter.provenance.session_ids);
          if (sessionIds.length > MAX_FILTER_PROVENANCE_VALUES) {
            throw invalidRequestError(
              `too many filter.provenance.session_ids (max=${MAX_FILTER_PROVENANCE_VALUES})`,
            );
          }
          if (sessionIds.length > 0) provenance.session_ids = sessionIds;
        }
        if (Object.keys(provenance).length > 0) next.provenance = provenance;
      }

      if (Object.keys(next).length > 0) normalizedFilter = next;
    }

    const queryParts = buildMemoryV1ItemQueryParts({
      agent,
      filter: normalizedFilter,
      alwaysJoinProvenance: true,
    });
    const clauses: string[] = [...queryParts.where];
    const params: unknown[] = [...queryParts.values];

    if (terms.length > 0) {
      const contains =
        this.db.kind === "sqlite"
          ? (haystack: string): string => `instr(${haystack}, ?) > 0`
          : (haystack: string): string => `strpos(${haystack}, ?) > 0`;
      const termClauses: string[] = [];
      for (const term of terms) {
        termClauses.push(
          `(
            (i.title IS NOT NULL AND ${contains("LOWER(i.title)")})
            OR (i.body_md IS NOT NULL AND ${contains("LOWER(i.body_md)")})
            OR (i.summary_md IS NOT NULL AND ${contains("LOWER(i.summary_md)")})
            OR (i.key IS NOT NULL AND ${contains("LOWER(i.key)")})
          )`,
        );
        params.push(term, term, term, term);
      }

      clauses.push(`(${termClauses.join("\n            OR ")})`);
    }

    const totalParams = params.length + 1; // include LIMIT
    if (totalParams > MAX_SQL_PARAMS) {
      throw invalidRequestError(
        `search too complex (params=${totalParams}, max=${MAX_SQL_PARAMS})`,
      );
    }

    const rows = await this.db.all<RawSearchRow>(
      `SELECT
         i.memory_item_id,
         i.kind,
         i.key,
         i.title,
         i.body_md,
         i.summary_md,
         i.created_at,
         p.source_kind,
         p.channel,
         p.thread_id,
         p.session_id,
         p.message_id,
         p.tool_call_id,
         p.refs_json,
         p.metadata_json
       FROM ${queryParts.from}
       WHERE ${clauses.join("\n         AND ")}
       ORDER BY i.created_at DESC
       LIMIT ?`,
      [...params, candidateLimit],
    );

    const scored = rows.map((row) => {
      const provenance: MemoryProvenance = {
        source_kind: row.source_kind,
        ...(row.channel ? { channel: row.channel } : {}),
        ...(row.thread_id ? { thread_id: row.thread_id } : {}),
        ...(row.session_id ? { session_id: row.session_id } : {}),
        ...(row.message_id ? { message_id: row.message_id } : {}),
        ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
        refs: parseJson<string[]>(row.refs_json),
        ...(row.metadata_json ? { metadata: parseJson<unknown>(row.metadata_json) } : {}),
      };

      const title = row.title ?? "";
      const key = row.key ?? "";
      const body = row.body_md ? markdownToPlainText(row.body_md) : "";
      const summary = row.summary_md ? markdownToPlainText(row.summary_md) : "";

      const titleLower = title.toLowerCase();
      const keyLower = key.toLowerCase();
      const bodyLower = body.toLowerCase();
      const summaryLower = summary.toLowerCase();

      let score = 0;
      for (const term of terms) {
        if (titleLower.includes(term)) score += 3;
        if (keyLower.includes(term)) score += 2;
        if (summaryLower.includes(term)) score += 2;
        if (bodyLower.includes(term)) score += 1;
      }

      const snippetSource =
        terms.length > 0 && titleLower && terms.some((t) => titleLower.includes(t))
          ? title
          : terms.length > 0 && bodyLower && terms.some((t) => bodyLower.includes(t))
            ? body
            : terms.length > 0 && summaryLower && terms.some((t) => summaryLower.includes(t))
              ? summary
              : key.length > 0
                ? key
                : title.length > 0
                  ? title
                  : body.length > 0
                    ? body
                    : summary;

      const snippet =
        snippetSource.length > 0 ? buildSnippet(snippetSource, terms, 240) : undefined;

      return {
        memory_item_id: row.memory_item_id,
        kind: row.kind,
        score: Math.max(0, score),
        ...(snippet ? { snippet } : {}),
        provenance,
        _created_at: normalizeTime(row.created_at),
      };
    });

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a._created_at !== b._created_at) return b._created_at.localeCompare(a._created_at);
      return a.memory_item_id.localeCompare(b.memory_item_id);
    });

    const hits = scored.slice(0, limit).map(({ _created_at, ...hit }) => hit);
    return { v: 1, hits, next_cursor: undefined };
  }

  async delete(
    memoryItemId: string,
    params: { deleted_by: MemoryDeletedBy; reason?: string },
    agentId?: string,
  ): Promise<MemoryTombstone> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existingTombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (existingTombstone) {
        await tx.run(
          `DELETE FROM memory_items
           WHERE agent_id = ? AND memory_item_id = ?`,
          [agent, memoryItemId],
        );
        return {
          v: 1,
          memory_item_id: existingTombstone.memory_item_id,
          agent_id: existingTombstone.agent_id,
          deleted_at: normalizeTime(existingTombstone.deleted_at),
          deleted_by: existingTombstone.deleted_by,
          ...(existingTombstone.reason ? { reason: existingTombstone.reason } : {}),
        };
      }

      const exists = await tx.get<{ memory_item_id: string }>(
        `SELECT memory_item_id
         FROM memory_items
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (!exists) throw new Error("memory item not found");

      await tx.run(
        `INSERT INTO memory_tombstones (memory_item_id, agent_id, deleted_at, deleted_by, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_item_id) DO NOTHING`,
        [memoryItemId, agent, nowIso, params.deleted_by, params.reason ?? null],
      );

      await tx.run(
        `DELETE FROM memory_items
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );

      const tombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (!tombstone) throw new Error("failed to read created tombstone");

      return {
        v: 1,
        memory_item_id: tombstone.memory_item_id,
        agent_id: tombstone.agent_id,
        deleted_at: normalizeTime(tombstone.deleted_at),
        deleted_by: tombstone.deleted_by,
        ...(tombstone.reason ? { reason: tombstone.reason } : {}),
      };
    });
  }

  async getTombstoneById(
    memoryItemId: string,
    agentId?: string,
  ): Promise<MemoryTombstone | undefined> {
    const agent = this.normalizeAgentId(agentId);
    const tombstone = await this.db.get<RawTombstoneRow>(
      `SELECT *
       FROM memory_tombstones
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
    );
    if (!tombstone) return undefined;

    return {
      v: 1,
      memory_item_id: tombstone.memory_item_id,
      agent_id: tombstone.agent_id,
      deleted_at: normalizeTime(tombstone.deleted_at),
      deleted_by: tombstone.deleted_by,
      ...(tombstone.reason ? { reason: tombstone.reason } : {}),
    };
  }

  async consolidateToBudgets(params: {
    budgets: AgentConfig["memory"]["v1"]["budgets"];
    agentId?: string;
  }): Promise<MemoryV1ConsolidationResult> {
    const agent = this.normalizeAgentId(params.agentId);
    const limits = normalizeBudgets(params.budgets);

    const loadRows = async (): Promise<RawBudgetRow[]> =>
      await this.db.all<RawBudgetRow>(
        `SELECT
           memory_item_id,
           kind,
           sensitivity,
           key,
           value_json,
           observed_at,
           title,
           body_md,
           occurred_at,
           summary_md,
           confidence,
           created_at
         FROM memory_items
         WHERE agent_id = ?`,
        [agent],
      );

    const beforeRows = await loadRows();
    const beforeUsage = computeBudgetUsage(beforeRows);
    if (!overBudget(beforeUsage, limits)) {
      return {
        ran: false,
        created_items: [],
        deleted_tombstones: [],
        dropped_derived_indexes: { deleted_vectors: 0, deleted_links: 0 },
        before: beforeUsage,
        after: beforeUsage,
      };
    }

    const createdItems: MemoryItem[] = [];
    const deletedTombstones: MemoryTombstone[] = [];

    // Stage 1: Dedupe facts by key (keep highest confidence / newest observed_at).
    {
      const facts = beforeRows.filter((row) => row.kind === "fact" && row.key);
      const bestByKey = new Map<string, RawBudgetRow>();
      const dupes: string[] = [];

      const compare = (a: RawBudgetRow, b: RawBudgetRow): number => {
        const confA = a.confidence ?? 0;
        const confB = b.confidence ?? 0;
        if (confA !== confB) return confB - confA;
        const obsA = a.observed_at ?? "";
        const obsB = b.observed_at ?? "";
        if (obsA !== obsB) return obsB.localeCompare(obsA);
        const createdA = normalizeTime(a.created_at);
        const createdB = normalizeTime(b.created_at);
        if (createdA !== createdB) return createdB.localeCompare(createdA);
        return b.memory_item_id.localeCompare(a.memory_item_id);
      };

      for (const fact of facts) {
        const key = fact.key!;
        const existing = bestByKey.get(key);
        if (!existing) {
          bestByKey.set(key, fact);
          continue;
        }
        const cmp = compare(existing, fact);
        if (cmp <= 0) {
          // existing is as-good or better -> delete current
          dupes.push(fact.memory_item_id);
        } else {
          // current is better -> delete existing
          dupes.push(existing.memory_item_id);
          bestByKey.set(key, fact);
        }
      }

      for (const id of dupes) {
        try {
          const tombstone = await this.delete(
            id,
            { deleted_by: "consolidation", reason: "dedupe/merge" },
            agent,
          );
          deletedTombstones.push(tombstone);
        } catch (err) {
          if (err instanceof Error && err.message === "memory item not found") continue;
          throw err;
        }
      }
    }

    let rows = await loadRows();
    let usage = computeBudgetUsage(rows);

    // Stage 2: Episodic consolidation into a semantic note (best-effort).
    if (rows.some((row) => row.kind === "episode") && overBudget(usage, limits)) {
      const episodes = rows
        .filter((row) => row.kind === "episode" && row.summary_md && row.occurred_at)
        .sort((a, b) => {
          const oa = a.occurred_at ?? "";
          const ob = b.occurred_at ?? "";
          if (oa !== ob) return oa.localeCompare(ob);
          const ca = normalizeTime(a.created_at);
          const cb = normalizeTime(b.created_at);
          if (ca !== cb) return ca.localeCompare(cb);
          return a.memory_item_id.localeCompare(b.memory_item_id);
        });

      const totalExcessItems = Math.max(0, usage.total.items - limits.max_total_items);
      const excessEpisodeItems = Math.max(
        0,
        usage.per_kind.episode.items - limits.per_kind.episode.max_items,
      );
      const desiredEpisodeCount = Math.max(excessEpisodeItems, totalExcessItems + 1);
      const targetCount = Math.min(episodes.length, Math.max(0, desiredEpisodeCount));

      const noteLimit = limits.per_kind.note;
      const noteUsage = usage.per_kind.note;
      const canAddNote =
        noteLimit.max_items > noteUsage.items && noteLimit.max_chars > noteUsage.chars;

      if (canAddNote && targetCount > 0) {
        const selected = episodes.slice(0, targetCount);
        const removedEpisodeChars = selected.reduce(
          (acc, row) => acc + memoryItemCharCount(row),
          0,
        );
        const maxNewNoteChars = Math.max(
          0,
          Math.min(noteLimit.max_chars - noteUsage.chars, Math.floor(removedEpisodeChars * 0.7)),
        );

        const occurredLines = selected.map((row) => {
          const occurred = row.occurred_at ?? "unknown-time";
          const summary = row.summary_md ? truncate(normalizeSummaryLine(row.summary_md), 180) : "";
          return `- ${occurred} — ${summary}`.trim();
        });

        const header = `Consolidated ${selected.length} episode(s) to stay within memory budgets.`;
        const body = [header, "", ...occurredLines].join("\n").trim();
        const title = "Episodic consolidation";

        const bodyBudget = Math.max(1, Math.max(0, maxNewNoteChars - title.length));
        const finalBody = truncate(body, bodyBudget);

        const sensitivity: MemorySensitivity = selected.some(
          (row) => row.sensitivity === "sensitive",
        )
          ? "sensitive"
          : selected.some((row) => row.sensitivity === "private")
            ? "private"
            : "public";

        const note = await this.create(
          {
            kind: "note",
            title,
            body_md: finalBody.length > 0 ? finalBody : header,
            tags: ["consolidated"],
            sensitivity,
            provenance: {
              source_kind: "system",
              refs: [],
              metadata: { kind: "episodic_consolidation", episode_count: selected.length },
            },
          },
          agent,
        );
        createdItems.push(note);

        for (const episode of selected) {
          try {
            const tombstone = await this.delete(
              episode.memory_item_id,
              { deleted_by: "consolidation", reason: "episodic consolidation" },
              agent,
            );
            deletedTombstones.push(tombstone);
          } catch (err) {
            if (err instanceof Error && err.message === "memory item not found") continue;
            throw err;
          }
        }
      }
    }

    // Stage 3: Drop derived indexes (embeddings) — expendable.
    const deletedLinks = (
      await this.db.run(`DELETE FROM memory_item_embeddings WHERE agent_id = ?`, [agent])
    ).changes;
    const deletedVectors = (
      await this.db.run(
        `DELETE FROM vector_metadata
         WHERE agent_id = ?
           AND label LIKE ?`,
        [agent, "memory_item:%"],
      )
    ).changes;

    rows = await loadRows();
    usage = computeBudgetUsage(rows);

    // Stage 4: Evict low-utility items until under budget.
    const kindPriority: readonly MemoryItemKind[] = ["episode", "note", "procedure", "fact"];

    const pickEvictionKind = (): MemoryItemKind | undefined => {
      for (const kind of kindPriority) {
        const limit = limits.per_kind[kind];
        const actual = usage.per_kind[kind];
        if (actual.items > limit.max_items) return kind;
        if (actual.chars > limit.max_chars) return kind;
      }
      if (
        usage.total.items > limits.max_total_items ||
        usage.total.chars > limits.max_total_chars
      ) {
        for (const kind of kindPriority) {
          if (usage.per_kind[kind].items > 0) return kind;
        }
      }
      return undefined;
    };

    const rowUtilityKey = (row: RawBudgetRow): string => {
      if (row.kind === "fact") return row.observed_at ?? normalizeTime(row.created_at);
      if (row.kind === "episode") return row.occurred_at ?? normalizeTime(row.created_at);
      return normalizeTime(row.created_at);
    };

    while (overBudget(usage, limits)) {
      const kind = pickEvictionKind();
      if (!kind) break;

      const candidates = rows.filter((row) => row.kind === kind);
      if (candidates.length === 0) break;

      const needCharRelief =
        usage.total.chars > limits.max_total_chars ||
        usage.per_kind[kind].chars > limits.per_kind[kind].max_chars;

      const sorted = candidates.slice().sort((a, b) => {
        const charsA = memoryItemCharCount(a);
        const charsB = memoryItemCharCount(b);

        if (needCharRelief && charsA !== charsB) return charsB - charsA;

        if (a.kind === "fact") {
          const confA = a.confidence ?? 0;
          const confB = b.confidence ?? 0;
          if (confA !== confB) return confA - confB;
        }

        const keyA = rowUtilityKey(a);
        const keyB = rowUtilityKey(b);
        if (keyA !== keyB) return keyA.localeCompare(keyB); // oldest first
        return a.memory_item_id.localeCompare(b.memory_item_id);
      });

      const victim = sorted[0]!;
      try {
        const tombstone = await this.delete(
          victim.memory_item_id,
          { deleted_by: "budget", reason: "memory budget exceeded" },
          agent,
        );
        deletedTombstones.push(tombstone);
      } catch (err) {
        if (err instanceof Error && err.message === "memory item not found") {
          rows = await loadRows();
          usage = computeBudgetUsage(rows);
          continue;
        }
        throw err;
      }

      rows = await loadRows();
      usage = computeBudgetUsage(rows);
    }

    const afterUsage = usage;
    if (overBudget(afterUsage, limits)) {
      throw new Error("memory v1 consolidation failed to return under budget");
    }

    return {
      ran: true,
      created_items: createdItems,
      deleted_tombstones: deletedTombstones,
      dropped_derived_indexes: { deleted_vectors: deletedVectors, deleted_links: deletedLinks },
      before: beforeUsage,
      after: afterUsage,
    };
  }
}
