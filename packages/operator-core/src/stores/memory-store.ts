import type {
  MemoryForgetSelector,
  MemoryItemId,
  MemoryItem,
  MemoryItemFilter,
  MemoryItemPatch,
  MemorySearchHit,
  MemoryTombstone,
} from "@tyrum/client";
import type { OperatorWsClient } from "../deps.js";
import { toOperatorCoreError, type OperatorCoreError } from "../operator-error.js";
import { createStore, type ExternalStore } from "../store.js";

export type MemoryBrowseRequest =
  | {
      kind: "list";
      filter?: MemoryItemFilter;
      limit?: number;
    }
  | {
      kind: "search";
      query: string;
      filter?: MemoryItemFilter;
      limit?: number;
    };

export type MemoryBrowseResults =
  | {
      kind: "list";
      items: MemoryItem[];
      nextCursor: string | null;
    }
  | {
      kind: "search";
      hits: MemorySearchHit[];
      nextCursor: string | null;
    };

export interface MemoryBrowseState {
  request: MemoryBrowseRequest | null;
  results: MemoryBrowseResults | null;
  loading: boolean;
  error: OperatorCoreError | null;
  lastSyncedAt: string | null;
}

export interface MemoryInspectState {
  memoryItemId: MemoryItemId | null;
  item: MemoryItem | null;
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface MemoryTombstonesState {
  tombstones: MemoryTombstone[];
  loading: boolean;
  error: OperatorCoreError | null;
}

export interface MemoryExportState {
  running: boolean;
  artifactId: string | null;
  error: OperatorCoreError | null;
  lastExportedAt: string | null;
}

export interface MemoryState {
  browse: MemoryBrowseState;
  inspect: MemoryInspectState;
  tombstones: MemoryTombstonesState;
  export: MemoryExportState;
}

export interface MemoryStore extends ExternalStore<MemoryState> {
  list(input?: { filter?: MemoryItemFilter; limit?: number }): Promise<void>;
  search(input: { query: string; filter?: MemoryItemFilter; limit?: number }): Promise<void>;
  loadMore(): Promise<void>;
  inspect(memoryItemId: MemoryItemId): Promise<void>;
  update(memoryItemId: MemoryItemId, patch: MemoryItemPatch): Promise<MemoryItem>;
  forget(selectors: MemoryForgetSelector[]): Promise<void>;
  export(input?: { filter?: MemoryItemFilter; includeTombstones?: boolean }): Promise<void>;
}

function toCursor(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function findItemInBrowseResults(
  results: MemoryBrowseResults | null,
  memoryItemId: MemoryItemId,
): MemoryItem | null {
  if (!results) return null;
  if (results.kind !== "list") return null;
  return results.items.find((item) => item.memory_item_id === memoryItemId) ?? null;
}

function removeFromBrowseResults(
  results: MemoryBrowseResults | null,
  deletedIds: Set<string>,
): MemoryBrowseResults | null {
  if (!results) return null;
  if (results.kind === "list") {
    const items = results.items.filter((item) => !deletedIds.has(item.memory_item_id));
    return { ...results, items };
  }
  const hits = results.hits.filter((hit) => !deletedIds.has(hit.memory_item_id));
  return { ...results, hits };
}

function upsertTombstones(prev: MemoryTombstone[], incoming: MemoryTombstone[]): MemoryTombstone[] {
  if (incoming.length === 0) return prev;
  const byId = new Map<string, MemoryTombstone>();
  for (const entry of incoming) {
    byId.set(entry.memory_item_id, entry);
  }
  for (const entry of prev) {
    if (!byId.has(entry.memory_item_id)) {
      byId.set(entry.memory_item_id, entry);
    }
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

type MemoryConsolidation = { fromIds: Set<string>; item: MemoryItem };

function countItemsBeforeConsolidationAnchor(
  items: { memory_item_id: string }[],
  anchorIndex: number,
  fromIds: Set<string>,
  consolidatedItemId: string,
): number {
  let index = 0;
  for (const entry of items.slice(0, anchorIndex)) {
    if (!fromIds.has(entry.memory_item_id) && entry.memory_item_id !== consolidatedItemId) {
      index++;
    }
  }
  return index;
}

function applyConsolidationsToListItems(
  items: MemoryItem[],
  consolidations: MemoryConsolidation[],
): MemoryItem[] {
  if (consolidations.length === 0) return items;
  let next = items;
  for (const consolidation of consolidations) {
    const anchorIndex = next.findIndex((entry) => consolidation.fromIds.has(entry.memory_item_id));
    if (anchorIndex === -1) continue;
    const filtered = next.filter(
      (entry) =>
        !consolidation.fromIds.has(entry.memory_item_id) &&
        entry.memory_item_id !== consolidation.item.memory_item_id,
    );
    const insertIndex = countItemsBeforeConsolidationAnchor(
      next,
      anchorIndex,
      consolidation.fromIds,
      consolidation.item.memory_item_id,
    );
    filtered.splice(insertIndex, 0, consolidation.item);
    next = filtered;
  }
  return next;
}

function applyConsolidationsToHits(
  hits: MemorySearchHit[],
  consolidations: MemoryConsolidation[],
): MemorySearchHit[] {
  if (consolidations.length === 0) return hits;
  const fromIds = new Set<string>();
  for (const consolidation of consolidations) {
    for (const id of consolidation.fromIds) {
      fromIds.add(id);
    }
  }
  if (fromIds.size === 0) return hits;
  return hits.filter((hit) => !fromIds.has(hit.memory_item_id));
}

export function createMemoryStore(ws: OperatorWsClient): {
  store: MemoryStore;
  handleMemoryItemUpsert: (item: MemoryItem) => void;
  handleMemoryTombstone: (tombstone: MemoryTombstone) => void;
  handleMemoryConsolidated: (fromMemoryItemIds: MemoryItemId[], item: MemoryItem) => void;
  handleMemoryExportCompleted: (artifactId: string) => void;
} {
  const { store, setState } = createStore<MemoryState>({
    browse: {
      request: null,
      results: null,
      loading: false,
      error: null,
      lastSyncedAt: null,
    },
    inspect: {
      memoryItemId: null,
      item: null,
      loading: false,
      error: null,
    },
    tombstones: {
      tombstones: [],
      loading: false,
      error: null,
    },
    export: {
      running: false,
      artifactId: null,
      error: null,
      lastExportedAt: null,
    },
  });

  let browseRunId = 0;
  let activeBrowseRunId: number | null = null;
  let bufferedItemUpserts = new Map<string, MemoryItem>();
  let bufferedDeletedIds = new Set<string>();
  let bufferedConsolidations: MemoryConsolidation[] = [];

  function resetBrowseBuffers(): void {
    bufferedItemUpserts = new Map<string, MemoryItem>();
    bufferedDeletedIds = new Set<string>();
    bufferedConsolidations = [];
  }

  let inspectRunId = 0;
  let activeInspectRunId: number | null = null;

  let forgetRunId = 0;
  let activeForgetRunId: number | null = null;

  let exportRunId = 0;
  let activeExportRunId: number | null = null;

  async function list(input?: { filter?: MemoryItemFilter; limit?: number }): Promise<void> {
    const runId = ++browseRunId;
    activeBrowseRunId = runId;
    resetBrowseBuffers();

    const request: MemoryBrowseRequest = {
      kind: "list",
      filter: input?.filter,
      limit: input?.limit,
    };

    setState((prev) => ({
      ...prev,
      browse: {
        ...prev.browse,
        request,
        results: null,
        loading: true,
        error: null,
      },
    }));

    try {
      const result = await ws.memoryList({
        v: 1,
        filter: input?.filter,
        limit: input?.limit,
        cursor: undefined,
      });
      if (activeBrowseRunId !== runId) return;
      const upserts = bufferedItemUpserts;
      const deletes = bufferedDeletedIds;
      const consolidations = bufferedConsolidations;

      setState((prev) => {
        let items = applyConsolidationsToListItems(result.items, consolidations);
        if (deletes.size > 0) {
          items = items.filter((item) => !deletes.has(item.memory_item_id));
        }
        items = applyItemUpserts(items, upserts);

        return {
          ...prev,
          browse: {
            ...prev.browse,
            request,
            results: {
              kind: "list",
              items,
              nextCursor: toCursor(result.next_cursor),
            },
            loading: false,
            lastSyncedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      if (activeBrowseRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        browse: {
          ...prev.browse,
          loading: false,
          error: toOperatorCoreError("ws", "memory.list", error),
        },
      }));
    } finally {
      if (activeBrowseRunId === runId) {
        activeBrowseRunId = null;
        resetBrowseBuffers();
      }
    }
  }

  async function search(input: {
    query: string;
    filter?: MemoryItemFilter;
    limit?: number;
  }): Promise<void> {
    const runId = ++browseRunId;
    activeBrowseRunId = runId;
    resetBrowseBuffers();

    const request: MemoryBrowseRequest = {
      kind: "search",
      query: input.query,
      filter: input.filter,
      limit: input.limit,
    };

    setState((prev) => ({
      ...prev,
      browse: {
        ...prev.browse,
        request,
        results: null,
        loading: true,
        error: null,
      },
    }));

    try {
      const result = await ws.memorySearch({
        v: 1,
        query: input.query,
        filter: input.filter,
        limit: input.limit,
        cursor: undefined,
      });
      if (activeBrowseRunId !== runId) return;
      const deletes = bufferedDeletedIds;
      const consolidations = bufferedConsolidations;

      setState((prev) => {
        let hits = applyConsolidationsToHits(result.hits, consolidations);
        if (deletes.size > 0) {
          hits = hits.filter((hit) => !deletes.has(hit.memory_item_id));
        }
        return {
          ...prev,
          browse: {
            ...prev.browse,
            request,
            results: {
              kind: "search",
              hits,
              nextCursor: toCursor(result.next_cursor),
            },
            loading: false,
            lastSyncedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      if (activeBrowseRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        browse: {
          ...prev.browse,
          loading: false,
          error: toOperatorCoreError("ws", "memory.search", error),
        },
      }));
    } finally {
      if (activeBrowseRunId === runId) {
        activeBrowseRunId = null;
        resetBrowseBuffers();
      }
    }
  }

  async function loadMore(): Promise<void> {
    const snapshot = store.getSnapshot();
    const request = snapshot.browse.request;
    const results = snapshot.browse.results;
    if (!request || !results) return;
    const cursor = results.nextCursor;
    if (!cursor) return;

    const runId = ++browseRunId;
    activeBrowseRunId = runId;
    resetBrowseBuffers();

    setState((prev) => ({
      ...prev,
      browse: {
        ...prev.browse,
        loading: true,
        error: null,
      },
    }));

    try {
      if (request.kind === "list") {
        const next = await ws.memoryList({
          v: 1,
          filter: request.filter,
          limit: request.limit,
          cursor,
        });
        if (activeBrowseRunId !== runId) return;
        const upserts = bufferedItemUpserts;
        const deletes = bufferedDeletedIds;
        const consolidations = bufferedConsolidations;

        setState((prev) => {
          const prevResults = prev.browse.results;
          if (!prevResults || prevResults.kind !== "list") return prev;
          const prevItems = prevResults.items;
          let nextItems = next.items;

          const pendingConsolidations: MemoryConsolidation[] = [];
          for (const consolidation of consolidations) {
            const hasConsolidatedItem = prevItems.some(
              (entry) => entry.memory_item_id === consolidation.item.memory_item_id,
            );
            const hasFromIdInPrev = prevItems.some((entry) =>
              consolidation.fromIds.has(entry.memory_item_id),
            );

            if (hasConsolidatedItem && !hasFromIdInPrev) {
              nextItems = nextItems.filter(
                (entry) =>
                  !consolidation.fromIds.has(entry.memory_item_id) &&
                  entry.memory_item_id !== consolidation.item.memory_item_id,
              );
              continue;
            }

            pendingConsolidations.push(consolidation);
          }

          let items = [...prevItems, ...nextItems];
          items = applyConsolidationsToListItems(items, pendingConsolidations);
          if (deletes.size > 0) {
            items = items.filter((item) => !deletes.has(item.memory_item_id));
          }
          items = applyItemUpserts(items, upserts);
          return {
            ...prev,
            browse: {
              ...prev.browse,
              results: {
                kind: "list",
                items,
                nextCursor: toCursor(next.next_cursor),
              },
              loading: false,
              lastSyncedAt: new Date().toISOString(),
            },
          };
        });
        return;
      }

      const next = await ws.memorySearch({
        v: 1,
        query: request.query,
        filter: request.filter,
        limit: request.limit,
        cursor,
      });
      if (activeBrowseRunId !== runId) return;
      const deletes = bufferedDeletedIds;
      const consolidations = bufferedConsolidations;

      setState((prev) => {
        const prevResults = prev.browse.results;
        if (!prevResults || prevResults.kind !== "search") return prev;
        let hits = [...prevResults.hits, ...next.hits];
        hits = applyConsolidationsToHits(hits, consolidations);
        if (deletes.size > 0) {
          hits = hits.filter((hit) => !deletes.has(hit.memory_item_id));
        }
        return {
          ...prev,
          browse: {
            ...prev.browse,
            results: {
              kind: "search",
              hits,
              nextCursor: toCursor(next.next_cursor),
            },
            loading: false,
            lastSyncedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      if (activeBrowseRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        browse: {
          ...prev.browse,
          loading: false,
          error: toOperatorCoreError(
            "ws",
            request.kind === "list" ? "memory.list" : "memory.search",
            error,
          ),
        },
      }));
    } finally {
      if (activeBrowseRunId === runId) {
        activeBrowseRunId = null;
        resetBrowseBuffers();
      }
    }
  }

  async function inspect(memoryItemId: MemoryItemId): Promise<void> {
    const runId = ++inspectRunId;
    activeInspectRunId = runId;

    setState((prev) => ({
      ...prev,
      inspect: {
        ...prev.inspect,
        memoryItemId,
        item: findItemInBrowseResults(prev.browse.results, memoryItemId),
        loading: true,
        error: null,
      },
    }));

    try {
      const result = await ws.memoryGet({ v: 1, memory_item_id: memoryItemId });
      if (activeInspectRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        inspect: {
          ...prev.inspect,
          memoryItemId,
          item: result.item,
          loading: false,
        },
      }));
    } catch (error) {
      if (activeInspectRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        inspect: {
          ...prev.inspect,
          loading: false,
          error: toOperatorCoreError("ws", "memory.get", error),
        },
      }));
    } finally {
      if (activeInspectRunId === runId) {
        activeInspectRunId = null;
      }
    }
  }

  async function forget(selectors: MemoryForgetSelector[]): Promise<void> {
    const runId = ++forgetRunId;
    activeForgetRunId = runId;

    setState((prev) => ({
      ...prev,
      tombstones: { ...prev.tombstones, loading: true, error: null },
    }));

    try {
      const result = await ws.memoryForget({ v: 1, confirm: "FORGET", selectors });
      if (activeForgetRunId !== runId) return;

      const deletedIds = new Set<string>(result.tombstones.map((t) => t.memory_item_id));
      const inspectingId = store.getSnapshot().inspect.memoryItemId;
      if (inspectingId && deletedIds.has(inspectingId)) {
        activeInspectRunId = null;
      }

      setState((prev) => {
        const nextBrowseResults = removeFromBrowseResults(prev.browse.results, deletedIds);
        const shouldClearInspect = prev.inspect.memoryItemId
          ? deletedIds.has(prev.inspect.memoryItemId)
          : false;
        return {
          ...prev,
          browse: {
            ...prev.browse,
            results: nextBrowseResults
              ? { ...nextBrowseResults, nextCursor: nextBrowseResults.nextCursor ?? null }
              : prev.browse.results,
          },
          inspect: shouldClearInspect
            ? { ...prev.inspect, item: null, memoryItemId: null, loading: false, error: null }
            : prev.inspect,
          tombstones: {
            ...prev.tombstones,
            tombstones: upsertTombstones(prev.tombstones.tombstones, result.tombstones),
            loading: false,
          },
        };
      });
    } catch (error) {
      if (activeForgetRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        tombstones: {
          ...prev.tombstones,
          loading: false,
          error: toOperatorCoreError("ws", "memory.forget", error),
        },
      }));
    } finally {
      if (activeForgetRunId === runId) {
        activeForgetRunId = null;
      }
    }
  }

  async function update(memoryItemId: MemoryItemId, patch: MemoryItemPatch): Promise<MemoryItem> {
    const result = await ws.memoryUpdate({ v: 1, memory_item_id: memoryItemId, patch });
    handleMemoryItemUpsert(result.item);
    return result.item;
  }

  async function exportMemory(input?: {
    filter?: MemoryItemFilter;
    includeTombstones?: boolean;
  }): Promise<void> {
    const runId = ++exportRunId;
    activeExportRunId = runId;

    setState((prev) => ({
      ...prev,
      export: {
        ...prev.export,
        running: true,
        artifactId: null,
        error: null,
      },
    }));

    try {
      const result = await ws.memoryExport({
        v: 1,
        filter: input?.filter,
        include_tombstones: input?.includeTombstones ?? false,
      });
      if (activeExportRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        export: {
          ...prev.export,
          running: false,
          artifactId: result.artifact_id,
          lastExportedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      if (activeExportRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        export: {
          ...prev.export,
          running: false,
          error: toOperatorCoreError("ws", "memory.export", error),
        },
      }));
    } finally {
      if (activeExportRunId === runId) {
        activeExportRunId = null;
      }
    }
  }

  function handleMemoryItemUpsert(item: MemoryItem): void {
    if (activeBrowseRunId !== null) {
      bufferedItemUpserts.set(item.memory_item_id, item);
    }
    setState((prev) => {
      const browseResults = prev.browse.results;
      let nextBrowseResults = browseResults;
      if (browseResults?.kind === "list") {
        const index = browseResults.items.findIndex(
          (entry) => entry.memory_item_id === item.memory_item_id,
        );
        if (index !== -1) {
          const items = [...browseResults.items];
          items[index] = item;
          nextBrowseResults = { ...browseResults, items };
        }
      }

      const nextInspect =
        prev.inspect.memoryItemId === item.memory_item_id
          ? { ...prev.inspect, item }
          : prev.inspect;

      if (nextBrowseResults === browseResults && nextInspect === prev.inspect) return prev;
      return {
        ...prev,
        browse: { ...prev.browse, results: nextBrowseResults },
        inspect: nextInspect,
      };
    });
  }

  function handleMemoryTombstone(tombstone: MemoryTombstone): void {
    if (activeBrowseRunId !== null) {
      bufferedDeletedIds.add(tombstone.memory_item_id);
    }
    if (store.getSnapshot().inspect.memoryItemId === tombstone.memory_item_id) {
      activeInspectRunId = null;
    }
    const deletedIds = new Set<string>([tombstone.memory_item_id]);
    setState((prev) => ({
      ...prev,
      browse: { ...prev.browse, results: removeFromBrowseResults(prev.browse.results, deletedIds) },
      inspect:
        prev.inspect.memoryItemId === tombstone.memory_item_id
          ? { ...prev.inspect, memoryItemId: null, item: null, loading: false, error: null }
          : prev.inspect,
      tombstones: {
        ...prev.tombstones,
        tombstones: upsertTombstones(prev.tombstones.tombstones, [tombstone]),
      },
    }));
  }

  function handleMemoryConsolidated(fromMemoryItemIds: MemoryItemId[], item: MemoryItem): void {
    const fromIds = new Set<string>(fromMemoryItemIds);
    if (activeBrowseRunId !== null) {
      for (const id of fromMemoryItemIds) {
        bufferedDeletedIds.add(id);
      }
      bufferedConsolidations.push({ fromIds, item });
    }

    const inspectingId = store.getSnapshot().inspect.memoryItemId;
    if (inspectingId && fromIds.has(inspectingId)) {
      activeInspectRunId = null;
    }

    setState((prev) => {
      let nextBrowseResults = prev.browse.results;

      if (nextBrowseResults?.kind === "list") {
        const anchorIndex = nextBrowseResults.items.findIndex((entry) =>
          fromIds.has(entry.memory_item_id),
        );
        if (anchorIndex !== -1) {
          const filtered = nextBrowseResults.items.filter(
            (entry) =>
              !fromIds.has(entry.memory_item_id) && entry.memory_item_id !== item.memory_item_id,
          );
          const insertIndex = countItemsBeforeConsolidationAnchor(
            nextBrowseResults.items,
            anchorIndex,
            fromIds,
            item.memory_item_id,
          );
          filtered.splice(insertIndex, 0, item);
          nextBrowseResults = { ...nextBrowseResults, items: filtered };
        }
      } else if (nextBrowseResults?.kind === "search") {
        const filtered = nextBrowseResults.hits.filter((hit) => !fromIds.has(hit.memory_item_id));
        if (filtered.length !== nextBrowseResults.hits.length) {
          nextBrowseResults = { ...nextBrowseResults, hits: filtered };
        }
      }

      const nextInspect =
        prev.inspect.memoryItemId && fromIds.has(prev.inspect.memoryItemId)
          ? { ...prev.inspect, memoryItemId: null, item: null, loading: false, error: null }
          : prev.inspect.memoryItemId === item.memory_item_id
            ? { ...prev.inspect, item }
            : prev.inspect;

      if (nextBrowseResults === prev.browse.results && nextInspect === prev.inspect) return prev;

      return {
        ...prev,
        browse: { ...prev.browse, results: nextBrowseResults },
        inspect: nextInspect,
      };
    });
  }

  function handleMemoryExportCompleted(artifactId: string): void {
    setState((prev) => ({
      ...prev,
      export: {
        ...prev.export,
        running: false,
        artifactId,
        error: null,
        lastExportedAt: new Date().toISOString(),
      },
    }));
  }

  return {
    store: {
      ...store,
      list,
      search,
      loadMore,
      inspect,
      update,
      forget,
      export: exportMemory,
    },
    handleMemoryItemUpsert,
    handleMemoryTombstone,
    handleMemoryConsolidated,
    handleMemoryExportCompleted,
  };
}
