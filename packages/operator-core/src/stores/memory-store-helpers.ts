import type { MemoryItem, MemoryItemFilter, MemorySearchHit, MemoryTombstone } from "@tyrum/client";
import { AgentId } from "@tyrum/schemas";
import type {
  MemoryBrowseResults,
  MemoryBrowseState,
  MemoryBrowseRequest,
  MemoryInspectState,
  MemoryExportState,
  MemoryState,
} from "./memory-store.js";

type MemoryConsolidation = { fromIds: Set<string>; item: MemoryItem };
export type BrowseBuffers = {
  upserts: Map<string, MemoryItem>;
  deletedIds: Set<string>;
  consolidations: MemoryConsolidation[];
};

export function completeBrowseSuccess(
  prev: MemoryBrowseState,
  input: { request: MemoryBrowseRequest; results: MemoryBrowseResults; now: string },
): MemoryBrowseState {
  return {
    ...prev,
    request: input.request,
    results: input.results,
    loading: false,
    error: null,
    lastSyncedAt: input.now,
  };
}

export const filterByDeletedIds = <T extends { memory_item_id: string }>(
  entries: T[],
  deletedIds: Set<string>,
): T[] =>
  deletedIds.size === 0
    ? entries
    : entries.filter((entry) => !deletedIds.has(entry.memory_item_id));

export function findItemInBrowseResults(
  results: MemoryBrowseResults | null,
  memoryItemId: string,
): MemoryItem | null {
  return results?.kind === "list"
    ? (results.items.find((item) => item.memory_item_id === memoryItemId) ?? null)
    : null;
}

export function removeFromBrowseResults(
  results: MemoryBrowseResults | null,
  deletedIds: Set<string>,
): MemoryBrowseResults | null {
  if (!results) return null;
  return results.kind === "list"
    ? { ...results, items: filterByDeletedIds(results.items, deletedIds) }
    : { ...results, hits: filterByDeletedIds(results.hits, deletedIds) };
}

export function replaceBrowseListItem(
  results: MemoryBrowseResults | null,
  item: MemoryItem,
): MemoryBrowseResults | null {
  if (results?.kind !== "list") return results;
  const index = results.items.findIndex((entry) => entry.memory_item_id === item.memory_item_id);
  if (index === -1) return results;
  const items = [...results.items];
  items[index] = item;
  return { ...results, items };
}

export function upsertTombstones(
  prev: MemoryTombstone[],
  incoming: MemoryTombstone[],
): MemoryTombstone[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(incoming.map((entry) => [entry.memory_item_id, entry] as const));
  for (const entry of prev) {
    if (!byId.has(entry.memory_item_id)) byId.set(entry.memory_item_id, entry);
  }
  return [...byId.values()];
}

function applyItemUpserts(items: MemoryItem[], upserts: Map<string, MemoryItem>): MemoryItem[] {
  if (upserts.size === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    const upserted = upserts.get(item.memory_item_id);
    if (!upserted) return item;
    changed = true;
    return upserted;
  });
  return changed ? next : items;
}

function countItemsBeforeConsolidationAnchor(
  items: { memory_item_id: string }[],
  anchorIndex: number,
  fromIds: Set<string>,
  consolidatedItemId: string,
): number {
  let index = 0;
  for (const entry of items.slice(0, anchorIndex)) {
    if (!fromIds.has(entry.memory_item_id) && entry.memory_item_id !== consolidatedItemId) index++;
  }
  return index;
}

function insertConsolidatedItem(
  items: MemoryItem[],
  fromIds: Set<string>,
  item: MemoryItem,
): MemoryItem[] {
  const anchorIndex = items.findIndex((entry) => fromIds.has(entry.memory_item_id));
  if (anchorIndex === -1) return items;
  const filtered = items.filter(
    (entry) => !fromIds.has(entry.memory_item_id) && entry.memory_item_id !== item.memory_item_id,
  );
  filtered.splice(
    countItemsBeforeConsolidationAnchor(items, anchorIndex, fromIds, item.memory_item_id),
    0,
    item,
  );
  return filtered;
}

function applyConsolidationsToListItems(
  items: MemoryItem[],
  consolidations: MemoryConsolidation[],
): MemoryItem[] {
  let next = items;
  for (const consolidation of consolidations)
    next = insertConsolidatedItem(next, consolidation.fromIds, consolidation.item);
  return next;
}

function collectConsolidatedFromIds(consolidations: MemoryConsolidation[]): Set<string> {
  const fromIds = new Set<string>();
  for (const consolidation of consolidations) {
    for (const id of consolidation.fromIds) fromIds.add(id);
  }
  return fromIds;
}

function applyConsolidationsToHits(
  hits: MemorySearchHit[],
  consolidations: MemoryConsolidation[],
): MemorySearchHit[] {
  const fromIds = collectConsolidatedFromIds(consolidations);
  return fromIds.size === 0 ? hits : filterByDeletedIds(hits, fromIds);
}

export function applyConsolidationToResults(
  results: MemoryBrowseResults | null,
  fromIds: Set<string>,
  item: MemoryItem,
): MemoryBrowseResults | null {
  if (!results) return results;
  if (results.kind === "list") {
    const items = insertConsolidatedItem(results.items, fromIds, item);
    return items === results.items ? results : { ...results, items };
  }
  const hits = filterByDeletedIds(results.hits, fromIds);
  return hits.length === results.hits.length ? results : { ...results, hits };
}

function filterLoadMoreConsolidations(
  prevItems: MemoryItem[],
  nextItems: MemoryItem[],
  consolidations: MemoryConsolidation[],
): { items: MemoryItem[]; pendingConsolidations: MemoryConsolidation[] } {
  const pendingConsolidations: MemoryConsolidation[] = [];
  let items = nextItems;
  for (const consolidation of consolidations) {
    const hasConsolidatedItem = prevItems.some(
      (entry) => entry.memory_item_id === consolidation.item.memory_item_id,
    );
    const hasFromIdInPrev = prevItems.some((entry) =>
      consolidation.fromIds.has(entry.memory_item_id),
    );
    if (hasConsolidatedItem && !hasFromIdInPrev) {
      items = items.filter(
        (entry) =>
          !consolidation.fromIds.has(entry.memory_item_id) &&
          entry.memory_item_id !== consolidation.item.memory_item_id,
      );
      continue;
    }
    pendingConsolidations.push(consolidation);
  }
  return { items, pendingConsolidations };
}

export function applyBrowseBuffers(
  results: MemoryBrowseResults,
  buffers: BrowseBuffers,
): MemoryBrowseResults {
  if (results.kind === "list") {
    const items = applyItemUpserts(
      filterByDeletedIds(
        applyConsolidationsToListItems(results.items, buffers.consolidations),
        buffers.deletedIds,
      ),
      buffers.upserts,
    );
    return { ...results, items };
  }
  return {
    ...results,
    hits: filterByDeletedIds(
      applyConsolidationsToHits(results.hits, buffers.consolidations),
      buffers.deletedIds,
    ),
  };
}

export function mergeBrowseResults(
  prevResults: MemoryBrowseResults | null,
  nextResults: MemoryBrowseResults,
  buffers: BrowseBuffers,
): MemoryBrowseResults | null {
  if (!prevResults || prevResults.kind !== nextResults.kind) return null;
  if (prevResults.kind === "list" && nextResults.kind === "list") {
    const { items: nextItems, pendingConsolidations } = filterLoadMoreConsolidations(
      prevResults.items,
      nextResults.items,
      buffers.consolidations,
    );
    const items = applyItemUpserts(
      filterByDeletedIds(
        applyConsolidationsToListItems([...prevResults.items, ...nextItems], pendingConsolidations),
        buffers.deletedIds,
      ),
      buffers.upserts,
    );
    return { kind: "list", items, nextCursor: nextResults.nextCursor };
  }
  if (prevResults.kind === "search" && nextResults.kind === "search") {
    const hits = filterByDeletedIds(
      applyConsolidationsToHits([...prevResults.hits, ...nextResults.hits], buffers.consolidations),
      buffers.deletedIds,
    );
    return { kind: "search", hits, nextCursor: nextResults.nextCursor };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Agent scope utilities
// ---------------------------------------------------------------------------

export const toCursor = (value: string | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const normalizeAgentScope = (agentId?: string | null): string | undefined => {
  const trimmed = agentId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const resolveAgentScope = (agentId?: string | null): string =>
  normalizeAgentScope(agentId) ?? "default";

const normalizeResolvedAgentId = (agentId?: string | null): string | null => {
  const normalized = normalizeAgentScope(agentId);
  return normalized && AgentId.safeParse(normalized).success ? normalized : null;
};

export const sameAgentScope = (a?: string | null, b?: string | null): boolean =>
  resolveAgentScope(a) === resolveAgentScope(b);

export const browseOperation = (request: MemoryBrowseRequest): "memory.list" | "memory.search" =>
  request.kind === "list" ? "memory.list" : "memory.search";

export const clearInspectSelection = (inspect: MemoryInspectState): MemoryInspectState => ({
  ...inspect,
  memoryItemId: null,
  item: null,
  loading: false,
  error: null,
});

export const completeExportSuccess = (
  prev: MemoryExportState,
  artifactId: string,
): MemoryExportState => ({
  ...prev,
  running: false,
  artifactId,
  error: null,
  lastExportedAt: new Date().toISOString(),
});

type MemoryListInput = { agentId?: string; filter?: MemoryItemFilter; limit?: number };
type MemorySearchInput = MemoryListInput & { query: string };
type ListRequest = { kind: "list" } & MemoryListInput;
type SearchRequest = { kind: "search"; query: string } & MemoryListInput;

export const buildListRequest = (input?: MemoryListInput): ListRequest => ({
  kind: "list",
  agentId: normalizeAgentScope(input?.agentId),
  filter: input?.filter,
  limit: input?.limit,
});

export const buildSearchRequest = (input: MemorySearchInput): SearchRequest => ({
  kind: "search",
  agentId: normalizeAgentScope(input.agentId),
  query: input.query,
  filter: input.filter,
  limit: input.limit,
});

export function findKnownAgentId(state: MemoryState): string | null {
  const inspectAgentId = normalizeResolvedAgentId(state.inspect.item?.agent_id);
  if (inspectAgentId) return inspectAgentId;
  if (state.browse.results?.kind === "list") {
    for (const item of state.browse.results.items) {
      const browseAgentId = normalizeResolvedAgentId(item.agent_id);
      if (browseAgentId) return browseAgentId;
    }
  }
  for (const tombstone of state.tombstones.tombstones) {
    const tombstoneAgentId = normalizeResolvedAgentId(tombstone.agent_id);
    if (tombstoneAgentId) return tombstoneAgentId;
  }
  return normalizeResolvedAgentId(state.inspect.agentId ?? state.browse.request?.agentId);
}

export function matchesCurrentScope(state: MemoryState, agentId?: string | null): boolean {
  const incomingAgentId = normalizeAgentScope(agentId);
  const currentAgentId = incomingAgentId ? findKnownAgentId(state) : null;
  return !incomingAgentId || !currentAgentId || currentAgentId === incomingAgentId;
}
