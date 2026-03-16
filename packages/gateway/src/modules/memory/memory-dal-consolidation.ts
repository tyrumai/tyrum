import type {
  BuiltinMemoryServerSettings,
  MemoryDeletedBy,
  MemoryItem,
  MemoryItemKind,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { MemoryConsolidationResult, RawBudgetRow } from "./memory-dal-types.js";
import type { MemoryCreateInput } from "./types.js";
import {
  computeBudgetUsage,
  memoryItemCharCount,
  normalizeBudgets,
  normalizeSummaryLine,
  normalizeTime,
  overBudget,
  sensitivityRank,
  truncate,
} from "./memory-dal-helpers.js";

type Scope = { tenantId: string; agentId: string };

type DalLike = {
  getById(memoryItemId: string, scope: Scope): Promise<MemoryItem | undefined>;
  delete(
    memoryItemId: string,
    params: { deleted_by: MemoryDeletedBy; reason?: string },
    scope: Scope,
  ): Promise<MemoryTombstone>;
  create(input: MemoryCreateInput, scope: Scope): Promise<MemoryItem>;
};

type NormalizedLimits = ReturnType<typeof normalizeBudgets>;
type BudgetUsage = ReturnType<typeof computeBudgetUsage>;

async function dedupeFactsByKey(
  beforeRows: RawBudgetRow[],
  dal: DalLike,
  scope: Scope,
  deletedTombstones: MemoryTombstone[],
): Promise<void> {
  const facts = beforeRows.filter((row) => row.kind === "fact" && row.key);
  const bestByKey = new Map<string, RawBudgetRow>();
  const dupes: string[] = [];

  const compare = (a: RawBudgetRow, b: RawBudgetRow): number => {
    const sensA = sensitivityRank(a.sensitivity);
    const sensB = sensitivityRank(b.sensitivity);
    if (sensA !== sensB) return sensB - sensA;
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
      dupes.push(fact.memory_item_id);
    } else {
      dupes.push(existing.memory_item_id);
      bestByKey.set(key, fact);
    }
  }

  for (const id of dupes) {
    try {
      const tombstone = await dal.delete(
        id,
        { deleted_by: "consolidation", reason: "dedupe/merge" },
        scope,
      );
      deletedTombstones.push(tombstone);
    } catch (err) {
      if (err instanceof Error && err.message === "memory item not found") continue;
      throw err;
    }
  }
}

async function consolidateEpisodes(
  rows: RawBudgetRow[],
  usage: BudgetUsage,
  limits: NormalizedLimits,
  dal: DalLike,
  scope: Scope,
  createdItems: MemoryItem[],
  deletedTombstones: MemoryTombstone[],
): Promise<void> {
  if (!rows.some((row) => row.kind === "episode") || !overBudget(usage, limits)) return;

  const episodes = rows
    .filter((row) => row.kind === "episode" && row.summary_md && row.occurred_at)
    .toSorted((a, b) => {
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
  const remainingNoteChars = Math.max(0, noteLimit.max_chars - noteUsage.chars);
  const canAddNote = noteLimit.max_items > noteUsage.items && remainingNoteChars > 0;

  if (!canAddNote || targetCount === 0) return;

  const selected = episodes.slice(0, targetCount);
  const removedEpisodeChars = selected.reduce((acc, row) => acc + memoryItemCharCount(row), 0);
  const maxNewNoteChars = Math.max(
    0,
    Math.floor(Math.min(remainingNoteChars, removedEpisodeChars * 0.7)),
  );
  if (maxNewNoteChars < 1) return;

  const occurredLines = selected.map((row) => {
    const occurred = row.occurred_at ?? "unknown-time";
    const summary = row.summary_md ? truncate(normalizeSummaryLine(row.summary_md), 180) : "";
    return `- ${occurred} — ${summary}`.trim();
  });

  const header = `Consolidated ${selected.length} episode(s) to stay within memory budgets.`;
  const body = [header, "", ...occurredLines].join("\n").trim();
  const titleCandidate = "Episodic consolidation";
  const title = maxNewNoteChars >= titleCandidate.length + 1 ? titleCandidate : undefined;
  const bodyBudget = maxNewNoteChars - (title?.length ?? 0);
  const finalBody = truncate(body, bodyBudget);

  const sensitivity: MemorySensitivity = selected.some((row) => row.sensitivity === "sensitive")
    ? "sensitive"
    : selected.some((row) => row.sensitivity === "private")
      ? "private"
      : "public";

  const note = await dal.create(
    {
      kind: "note",
      ...(title ? { title } : {}),
      body_md: finalBody.length > 0 ? finalBody : header,
      tags: ["consolidated"],
      sensitivity,
      provenance: {
        source_kind: "system",
        refs: [],
        metadata: { kind: "episodic_consolidation", episode_count: selected.length },
      },
    },
    scope,
  );
  createdItems.push(note);

  for (const episode of selected) {
    try {
      const tombstone = await dal.delete(
        episode.memory_item_id,
        { deleted_by: "consolidation", reason: "episodic consolidation" },
        scope,
      );
      deletedTombstones.push(tombstone);
    } catch (err) {
      if (err instanceof Error && err.message === "memory item not found") continue;
      throw err;
    }
  }
}

async function evictLowUtilityItems(
  loadRows: () => Promise<RawBudgetRow[]>,
  initialRows: RawBudgetRow[],
  initialUsage: BudgetUsage,
  limits: NormalizedLimits,
  dal: DalLike,
  scope: Scope,
  deletedTombstones: MemoryTombstone[],
): Promise<BudgetUsage> {
  const kindPriority: readonly MemoryItemKind[] = ["episode", "note", "procedure", "fact"];
  let rows = initialRows;
  let usage = initialUsage;

  const pickEvictionKind = (): MemoryItemKind | undefined => {
    for (const kind of kindPriority) {
      const kindLimit = limits.per_kind[kind];
      const actual = usage.per_kind[kind];
      if (actual.items > kindLimit.max_items) return kind;
      if (actual.chars > kindLimit.max_chars) return kind;
    }
    if (usage.total.items > limits.max_total_items || usage.total.chars > limits.max_total_chars) {
      for (const kind of kindPriority) {
        if (usage.per_kind[kind].items > 0) return kind;
      }
    }
    return undefined;
  };

  const rowUtilityKey = (row: RawBudgetRow): string => {
    if (row.kind === "fact") return row.observed_at ?? normalizeTime(row.created_at);
    if (row.kind === "episode") return row.occurred_at ?? normalizeTime(row.created_at);
    const updated = row.updated_at ? normalizeTime(row.updated_at) : undefined;
    return updated ?? normalizeTime(row.created_at);
  };

  while (overBudget(usage, limits)) {
    const kind = pickEvictionKind();
    if (!kind) break;

    const candidates = rows.filter((row) => row.kind === kind);
    if (candidates.length === 0) break;

    const needCharRelief =
      usage.total.chars > limits.max_total_chars ||
      usage.per_kind[kind].chars > limits.per_kind[kind].max_chars;

    const sorted = candidates.toSorted((a, b) => {
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
      const tombstone = await dal.delete(
        victim.memory_item_id,
        { deleted_by: "budget", reason: "memory budget exceeded" },
        scope,
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

  return usage;
}

export async function consolidateMemoryToBudgets(
  db: SqlDb,
  scope: Scope,
  budgets: BuiltinMemoryServerSettings["budgets"],
  dal: DalLike,
): Promise<MemoryConsolidationResult> {
  const limits = normalizeBudgets(budgets);

  const loadRows = async (): Promise<RawBudgetRow[]> =>
    await db.all<RawBudgetRow>(
      `SELECT
           memory_item_id, kind, sensitivity, key, value_json,
           observed_at, title, body_md, occurred_at, summary_md,
           confidence, created_at, updated_at
         FROM memory_items
         WHERE tenant_id = ? AND agent_id = ?`,
      [scope.tenantId, scope.agentId],
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

  // Stage 1: Dedupe facts by key.
  await dedupeFactsByKey(beforeRows, dal, scope, deletedTombstones);

  let rows = await loadRows();
  let usage = computeBudgetUsage(rows);
  if (!overBudget(usage, limits)) {
    return {
      ran: true,
      created_items: createdItems,
      deleted_tombstones: deletedTombstones,
      dropped_derived_indexes: { deleted_vectors: 0, deleted_links: 0 },
      before: beforeUsage,
      after: usage,
    };
  }

  // Stage 2: Episodic consolidation into a semantic note (best-effort).
  await consolidateEpisodes(rows, usage, limits, dal, scope, createdItems, deletedTombstones);

  rows = await loadRows();
  usage = computeBudgetUsage(rows);
  if (!overBudget(usage, limits)) {
    return {
      ran: true,
      created_items: createdItems,
      deleted_tombstones: deletedTombstones,
      dropped_derived_indexes: { deleted_vectors: 0, deleted_links: 0 },
      before: beforeUsage,
      after: usage,
    };
  }

  // Stage 3: Drop derived indexes (embeddings) — expendable.
  const deletedLinks = (
    await db.run(`DELETE FROM memory_item_embeddings WHERE tenant_id = ? AND agent_id = ?`, [
      scope.tenantId,
      scope.agentId,
    ])
  ).changes;
  const deletedVectors = (
    await db.run(
      `DELETE FROM vector_metadata WHERE tenant_id = ? AND agent_id = ? AND label LIKE ?`,
      [scope.tenantId, scope.agentId, "memory_item:%"],
    )
  ).changes;

  rows = await loadRows();
  usage = computeBudgetUsage(rows);

  // Stage 4: Evict low-utility items until under budget.
  const afterUsage = await evictLowUtilityItems(
    loadRows,
    rows,
    usage,
    limits,
    dal,
    scope,
    deletedTombstones,
  );

  if (overBudget(afterUsage, limits)) {
    throw new Error("memory consolidation failed to return under budget");
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
