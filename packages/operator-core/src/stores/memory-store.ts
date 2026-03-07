import type {
  MemoryForgetSelector,
  MemoryItem,
  MemoryItemFilter,
  MemoryItemId,
  MemoryItemPatch,
  MemorySearchHit,
  MemoryTombstone,
} from "@tyrum/client";
import type { OperatorWsClient } from "../deps.js";
import { toOperatorCoreError, type OperatorCoreError } from "../operator-error.js";
import { createStore, type ExternalStore } from "../store.js";
import {
  applyBrowseBuffers,
  applyConsolidationToResults,
  browseOperation,
  buildListRequest,
  buildSearchRequest,
  clearInspectSelection,
  completeBrowseSuccess,
  completeExportSuccess,
  findItemInBrowseResults,
  matchesCurrentScope,
  mergeBrowseResults,
  normalizeAgentScope,
  removeFromBrowseResults,
  replaceBrowseListItem,
  sameAgentScope,
  toCursor,
  upsertTombstones,
  type BrowseBuffers,
} from "./memory-store-helpers.js";

export { completeBrowseSuccess } from "./memory-store-helpers.js";

type MemoryListInput = { agentId?: string; filter?: MemoryItemFilter; limit?: number };
type MemorySearchInput = MemoryListInput & { query: string };
type MemoryExportInput = {
  agentId?: string;
  filter?: MemoryItemFilter;
  includeTombstones?: boolean;
};
type ListRequest = { kind: "list" } & MemoryListInput;
type SearchRequest = { kind: "search"; query: string } & MemoryListInput;
type ListResults = { kind: "list"; items: MemoryItem[]; nextCursor: string | null };
type SearchResults = { kind: "search"; hits: MemorySearchHit[]; nextCursor: string | null };
type MemoryConsolidation = { fromIds: Set<string>; item: MemoryItem };
type BrowseRunOptions = { reset?: boolean; cursor?: string; append?: boolean };

export type MemoryBrowseRequest = ListRequest | SearchRequest;
export type MemoryBrowseResults = ListResults | SearchResults;
export interface MemoryBrowseState {
  request: MemoryBrowseRequest | null;
  results: MemoryBrowseResults | null;
  loading: boolean;
  error: OperatorCoreError | null;
  lastSyncedAt: string | null;
}
export interface MemoryInspectState {
  agentId: string | null;
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
  list(input?: MemoryListInput): Promise<void>;
  search(input: MemorySearchInput): Promise<void>;
  refreshBrowse(): Promise<void>;
  loadMore(): Promise<void>;
  inspect(memoryItemId: MemoryItemId, input?: { agentId?: string }): Promise<void>;
  update(
    memoryItemId: MemoryItemId,
    patch: MemoryItemPatch,
    input?: { agentId?: string },
  ): Promise<MemoryItem>;
  forget(selectors: MemoryForgetSelector[], input?: { agentId?: string }): Promise<void>;
  export(input?: MemoryExportInput): Promise<void>;
}
export interface MemoryStoreBindings {
  store: MemoryStore;
  handleMemoryItemUpsert: (item: MemoryItem) => void;
  handleMemoryTombstone: (tombstone: MemoryTombstone) => void;
  handleMemoryConsolidated: (fromMemoryItemIds: MemoryItemId[], item: MemoryItem) => void;
  handleMemoryExportCompleted: (artifactId: string) => void;
}

const createBrowseState = (): MemoryBrowseState => ({
  request: null,
  results: null,
  loading: false,
  error: null,
  lastSyncedAt: null,
});
const createInspectState = (agentId: string | null = null): MemoryInspectState => ({
  agentId,
  memoryItemId: null,
  item: null,
  loading: false,
  error: null,
});
const createTombstonesState = (tombstones: MemoryTombstone[] = []): MemoryTombstonesState => ({
  tombstones,
  loading: false,
  error: null,
});
const createExportState = (): MemoryExportState => ({
  running: false,
  artifactId: null,
  error: null,
  lastExportedAt: null,
});
const createMemoryState = (): MemoryState => ({
  browse: createBrowseState(),
  inspect: createInspectState(),
  tombstones: createTombstonesState(),
  export: createExportState(),
});

export function createMemoryStore(ws: OperatorWsClient): MemoryStoreBindings {
  const { store, setState } = createStore<MemoryState>(createMemoryState());
  let browseRunId = 0;
  let activeBrowseRunId: number | null = null;
  let inspectRunId = 0;
  let activeInspectRunId: number | null = null;
  let forgetRunId = 0;
  let activeForgetRunId: number | null = null;
  let exportRunId = 0;
  let activeExportRunId: number | null = null;
  let bufferedItemUpserts = new Map<string, MemoryItem>();
  let bufferedDeletedIds = new Set<string>();
  let bufferedConsolidations: MemoryConsolidation[] = [];

  const resetBrowseBuffers = (): void => {
    bufferedItemUpserts = new Map<string, MemoryItem>();
    bufferedDeletedIds = new Set<string>();
    bufferedConsolidations = [];
  };
  const currentBrowseBuffers = (): BrowseBuffers => ({
    upserts: bufferedItemUpserts,
    deletedIds: bufferedDeletedIds,
    consolidations: bufferedConsolidations,
  });
  const startBrowseRun = (): number => {
    const runId = ++browseRunId;
    activeBrowseRunId = runId;
    resetBrowseBuffers();
    return runId;
  };
  const finishBrowseRun = (runId: number): void => {
    if (activeBrowseRunId === runId) {
      activeBrowseRunId = null;
      resetBrowseBuffers();
    }
  };
  const currentInspectAgentId = (agentId?: string | null): string | undefined =>
    normalizeAgentScope(agentId ?? store.getSnapshot().inspect.agentId);

  function startBrowseRequest(request: MemoryBrowseRequest): void {
    setState((prev) => {
      const agentId = request.agentId ?? null;
      const scopeChanged = !sameAgentScope(prev.inspect.agentId, request.agentId);
      return {
        ...prev,
        browse: { ...prev.browse, request, results: null, loading: true, error: null },
        inspect: scopeChanged ? createInspectState(agentId) : { ...prev.inspect, agentId },
        tombstones: scopeChanged ? createTombstonesState() : prev.tombstones,
      };
    });
  }

  function setBrowseLoading(): void {
    setState((prev) => ({ ...prev, browse: { ...prev.browse, loading: true, error: null } }));
  }

  async function fetchBrowseResults(
    request: MemoryBrowseRequest,
    cursor?: string,
  ): Promise<MemoryBrowseResults> {
    if (request.kind === "list") {
      const result = await ws.memoryList({
        v: 1,
        agent_id: request.agentId,
        filter: request.filter,
        limit: request.limit,
        cursor,
      });
      return { kind: "list", items: result.items, nextCursor: toCursor(result.next_cursor) };
    }
    const result = await ws.memorySearch({
      v: 1,
      agent_id: request.agentId,
      query: request.query,
      filter: request.filter,
      limit: request.limit,
      cursor,
    });
    return { kind: "search", hits: result.hits, nextCursor: toCursor(result.next_cursor) };
  }

  function commitBrowseSuccess(
    runId: number,
    request: MemoryBrowseRequest,
    results: MemoryBrowseResults,
    append = false,
  ): void {
    if (activeBrowseRunId !== runId) return;
    const buffers = currentBrowseBuffers();
    const now = new Date().toISOString();
    setState((prev) => {
      const nextResults = append
        ? mergeBrowseResults(prev.browse.results, results, buffers)
        : applyBrowseBuffers(results, buffers);
      return nextResults
        ? {
            ...prev,
            browse: completeBrowseSuccess(prev.browse, { request, results: nextResults, now }),
          }
        : prev;
    });
  }

  function commitBrowseError(runId: number, request: MemoryBrowseRequest, error: unknown): void {
    if (activeBrowseRunId !== runId) return;
    setState((prev) => ({
      ...prev,
      browse: {
        ...prev.browse,
        loading: false,
        error: toOperatorCoreError("ws", browseOperation(request), error),
      },
    }));
  }

  async function runBrowse(
    request: MemoryBrowseRequest,
    options: BrowseRunOptions = {},
  ): Promise<void> {
    const runId = startBrowseRun();
    if (options.reset) startBrowseRequest(request);
    else setBrowseLoading();
    try {
      commitBrowseSuccess(
        runId,
        request,
        await fetchBrowseResults(request, options.cursor),
        options.append,
      );
    } catch (error) {
      commitBrowseError(runId, request, error);
    } finally {
      finishBrowseRun(runId);
    }
  }

  async function list(input?: MemoryListInput): Promise<void> {
    return runBrowse(buildListRequest(input), { reset: true });
  }

  async function search(input: MemorySearchInput): Promise<void> {
    return runBrowse(buildSearchRequest(input), { reset: true });
  }

  async function refreshBrowse(): Promise<void> {
    const request = store.getSnapshot().browse.request;
    if (request) await runBrowse(request);
  }

  async function loadMore(): Promise<void> {
    const { request, results } = store.getSnapshot().browse;
    if (request && results?.nextCursor)
      await runBrowse(request, { cursor: results.nextCursor, append: true });
  }

  async function inspect(memoryItemId: MemoryItemId, input?: { agentId?: string }): Promise<void> {
    const runId = ++inspectRunId;
    activeInspectRunId = runId;
    const agentId = currentInspectAgentId(input?.agentId);
    setState((prev) => ({
      ...prev,
      inspect: {
        ...prev.inspect,
        agentId: agentId ?? null,
        memoryItemId,
        item: findItemInBrowseResults(prev.browse.results, memoryItemId),
        loading: true,
        error: null,
      },
    }));
    try {
      const result = await ws.memoryGet({ v: 1, agent_id: agentId, memory_item_id: memoryItemId });
      if (activeInspectRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        inspect: { ...prev.inspect, memoryItemId, item: result.item, loading: false },
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
      if (activeInspectRunId === runId) activeInspectRunId = null;
    }
  }

  async function forget(
    selectors: MemoryForgetSelector[],
    input?: { agentId?: string },
  ): Promise<void> {
    const runId = ++forgetRunId;
    activeForgetRunId = runId;
    const agentId = currentInspectAgentId(input?.agentId);
    setState((prev) => ({
      ...prev,
      tombstones: { ...prev.tombstones, loading: true, error: null },
    }));
    try {
      const result = await ws.memoryForget({
        v: 1,
        agent_id: agentId,
        confirm: "FORGET",
        selectors,
      });
      if (activeForgetRunId !== runId) return;
      const deletedIds = new Set(result.tombstones.map((tombstone) => tombstone.memory_item_id));
      const inspectingId = store.getSnapshot().inspect.memoryItemId;
      if (inspectingId && deletedIds.has(inspectingId)) activeInspectRunId = null;
      setState((prev) => ({
        ...prev,
        browse: {
          ...prev.browse,
          results: removeFromBrowseResults(prev.browse.results, deletedIds),
        },
        inspect:
          prev.inspect.memoryItemId && deletedIds.has(prev.inspect.memoryItemId)
            ? clearInspectSelection(prev.inspect)
            : prev.inspect,
        tombstones: {
          ...prev.tombstones,
          tombstones: upsertTombstones(prev.tombstones.tombstones, result.tombstones),
          loading: false,
        },
      }));
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
      if (activeForgetRunId === runId) activeForgetRunId = null;
    }
  }

  async function update(
    memoryItemId: MemoryItemId,
    patch: MemoryItemPatch,
    input?: { agentId?: string },
  ): Promise<MemoryItem> {
    const result = await ws.memoryUpdate({
      v: 1,
      agent_id: currentInspectAgentId(input?.agentId),
      memory_item_id: memoryItemId,
      patch,
    });
    handleMemoryItemUpsert(result.item);
    return result.item;
  }

  async function exportMemory(input?: MemoryExportInput): Promise<void> {
    const runId = ++exportRunId;
    activeExportRunId = runId;
    setState((prev) => ({
      ...prev,
      export: { ...prev.export, running: true, artifactId: null, error: null },
    }));
    try {
      const result = await ws.memoryExport({
        v: 1,
        agent_id: currentInspectAgentId(input?.agentId),
        filter: input?.filter,
        include_tombstones: input?.includeTombstones ?? false,
      });
      if (activeExportRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        export: completeExportSuccess(prev.export, result.artifact_id),
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
      if (activeExportRunId === runId) activeExportRunId = null;
    }
  }

  function handleMemoryItemUpsert(item: MemoryItem): void {
    if (!matchesCurrentScope(store.getSnapshot(), item.agent_id)) return;
    if (activeBrowseRunId !== null) bufferedItemUpserts.set(item.memory_item_id, item);
    setState((prev) => {
      const nextBrowseResults = replaceBrowseListItem(prev.browse.results, item);
      const nextInspect =
        prev.inspect.memoryItemId === item.memory_item_id
          ? { ...prev.inspect, item }
          : prev.inspect;
      return nextBrowseResults === prev.browse.results && nextInspect === prev.inspect
        ? prev
        : { ...prev, browse: { ...prev.browse, results: nextBrowseResults }, inspect: nextInspect };
    });
  }

  function handleMemoryTombstone(tombstone: MemoryTombstone): void {
    if (!matchesCurrentScope(store.getSnapshot(), tombstone.agent_id)) return;
    if (activeBrowseRunId !== null) bufferedDeletedIds.add(tombstone.memory_item_id);
    if (store.getSnapshot().inspect.memoryItemId === tombstone.memory_item_id)
      activeInspectRunId = null;
    const deletedIds = new Set<string>([tombstone.memory_item_id]);
    setState((prev) => ({
      ...prev,
      browse: { ...prev.browse, results: removeFromBrowseResults(prev.browse.results, deletedIds) },
      inspect:
        prev.inspect.memoryItemId === tombstone.memory_item_id
          ? clearInspectSelection(prev.inspect)
          : prev.inspect,
      tombstones: {
        ...prev.tombstones,
        tombstones: upsertTombstones(prev.tombstones.tombstones, [tombstone]),
      },
    }));
  }

  function handleMemoryConsolidated(fromMemoryItemIds: MemoryItemId[], item: MemoryItem): void {
    if (!matchesCurrentScope(store.getSnapshot(), item.agent_id)) return;
    const fromIds = new Set<string>(fromMemoryItemIds);
    if (activeBrowseRunId !== null) {
      for (const id of fromMemoryItemIds) bufferedDeletedIds.add(id);
      bufferedConsolidations.push({ fromIds, item });
    }
    const inspectingId = store.getSnapshot().inspect.memoryItemId;
    if (inspectingId && fromIds.has(inspectingId)) activeInspectRunId = null;
    setState((prev) => {
      const nextBrowseResults = applyConsolidationToResults(prev.browse.results, fromIds, item);
      const nextInspect =
        prev.inspect.memoryItemId && fromIds.has(prev.inspect.memoryItemId)
          ? clearInspectSelection(prev.inspect)
          : prev.inspect.memoryItemId === item.memory_item_id
            ? { ...prev.inspect, item }
            : prev.inspect;
      return nextBrowseResults === prev.browse.results && nextInspect === prev.inspect
        ? prev
        : { ...prev, browse: { ...prev.browse, results: nextBrowseResults }, inspect: nextInspect };
    });
  }

  function handleMemoryExportCompleted(artifactId: string): void {
    setState((prev) => ({ ...prev, export: completeExportSuccess(prev.export, artifactId) }));
  }

  return {
    store: {
      ...store,
      list,
      search,
      refreshBrowse,
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
