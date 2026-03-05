import type { PairingListResponse, PairingMutateResponse } from "@tyrum/client";
import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export type Pairing = PairingListResponse["pairings"][number];

export interface PairingState {
  byId: Record<number, Pairing>;
  pendingIds: number[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface PairingStore extends ExternalStore<PairingState> {
  refresh(): Promise<void>;
  approve(
    pairingId: number,
    input: Parameters<OperatorHttpClient["pairings"]["approve"]>[1],
  ): Promise<Pairing>;
  deny(
    pairingId: number,
    input?: Parameters<OperatorHttpClient["pairings"]["deny"]>[1],
  ): Promise<Pairing>;
  revoke(
    pairingId: number,
    input?: Parameters<OperatorHttpClient["pairings"]["revoke"]>[1],
  ): Promise<Pairing>;
}

type SetState<T> = (updater: (prev: T) => T) => void;

function upsertPairing(state: PairingState, pairing: Pairing): PairingState {
  const id = pairing.pairing_id;
  const byId = { ...state.byId, [id]: pairing };

  const shouldBePending = pairing.status === "pending";
  const isPending = state.pendingIds.includes(id);
  let pendingIds = state.pendingIds;

  if (shouldBePending && !isPending) {
    pendingIds = [...pendingIds, id];
  } else if (!shouldBePending && isPending) {
    pendingIds = pendingIds.filter((entry) => entry !== id);
  }

  return { ...state, byId, pendingIds };
}

function pairingFromMutation(result: PairingMutateResponse): Pairing {
  return result.pairing;
}

interface PairingRefreshState {
  runId: number;
  activeRunId: number | null;
  bufferedUpserts: Map<number, Pairing>;
}

function beginRefresh(state: PairingRefreshState): number {
  const runId = ++state.runId;
  state.activeRunId = runId;
  return runId;
}

function isRefreshActive(state: PairingRefreshState, runId: number): boolean {
  return state.activeRunId === runId;
}

function resetRefreshBuffer(state: PairingRefreshState): void {
  state.bufferedUpserts = new Map<number, Pairing>();
}

function handlePairingUpsertImpl(
  setState: SetState<PairingState>,
  refreshState: PairingRefreshState,
  pairing: Pairing,
): void {
  if (refreshState.activeRunId !== null) {
    refreshState.bufferedUpserts.set(pairing.pairing_id, pairing);
  }
  setState((prev) => upsertPairing(prev, pairing));
}

async function refreshImpl(
  http: OperatorHttpClient,
  setState: SetState<PairingState>,
  refreshState: PairingRefreshState,
): Promise<void> {
  const runId = beginRefresh(refreshState);
  resetRefreshBuffer(refreshState);

  setState((prev) => ({ ...prev, loading: true, error: null }));
  try {
    const result = await http.pairings.list();
    if (!isRefreshActive(refreshState, runId)) return;
    const buffered = refreshState.bufferedUpserts;

    const byId: Record<number, Pairing> = {};
    const pendingIds: number[] = [];
    for (const pairing of result.pairings) {
      byId[pairing.pairing_id] = pairing;
      if (pairing.status === "pending") {
        pendingIds.push(pairing.pairing_id);
      }
    }
    setState((prev) => {
      let next: PairingState = { ...prev, byId, pendingIds };
      for (const pairing of buffered.values()) {
        next = upsertPairing(next, pairing);
      }
      return {
        ...next,
        loading: false,
        lastSyncedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    if (!isRefreshActive(refreshState, runId)) return;
    setState((prev) => ({
      ...prev,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    if (refreshState.activeRunId === runId) {
      refreshState.activeRunId = null;
      resetRefreshBuffer(refreshState);
    }
  }
}

async function mutatePairingImpl(
  mutate: () => Promise<PairingMutateResponse>,
  setState: SetState<PairingState>,
  refreshState: PairingRefreshState,
): Promise<Pairing> {
  const result = await mutate();
  const pairing = pairingFromMutation(result);
  handlePairingUpsertImpl(setState, refreshState, pairing);
  return pairing;
}

export function createPairingStore(http: OperatorHttpClient): {
  store: PairingStore;
  handlePairingUpsert: (pairing: Pairing) => void;
} {
  const { store, setState } = createStore<PairingState>({
    byId: {},
    pendingIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  const refreshState: PairingRefreshState = {
    runId: 0,
    activeRunId: null,
    bufferedUpserts: new Map<number, Pairing>(),
  };

  return {
    store: {
      ...store,
      refresh: () => refreshImpl(http, setState, refreshState),
      approve: (pairingId, input) =>
        mutatePairingImpl(() => http.pairings.approve(pairingId, input), setState, refreshState),
      deny: (pairingId, input) =>
        mutatePairingImpl(() => http.pairings.deny(pairingId, input), setState, refreshState),
      revoke: (pairingId, input) =>
        mutatePairingImpl(() => http.pairings.revoke(pairingId, input), setState, refreshState),
    },
    handlePairingUpsert: (pairing) => handlePairingUpsertImpl(setState, refreshState, pairing),
  };
}
