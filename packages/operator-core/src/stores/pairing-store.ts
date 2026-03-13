import type { PairingListResponse, PairingMutateResponse } from "@tyrum/client";
import type { OperatorHttpClient } from "../deps.js";
import { ElevatedModeRequiredError } from "../elevated-mode.js";
import { createStore, type ExternalStore } from "../store.js";
import { isPairingBlockedStatus, isPairingHumanActionableStatus } from "../review-status.js";
import { beginRefresh, isRefreshActive, type RefreshRunState } from "./status-store.refresh-run.js";

export type Pairing = PairingListResponse["pairings"][number];

export interface PairingState {
  byId: Record<number, Pairing>;
  blockedIds: number[];
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
type GetPrivilegedHttpClient = () => OperatorHttpClient | null;

function collectPairingIds(pairings: Pairing[]): Pick<PairingState, "blockedIds" | "pendingIds"> {
  return {
    blockedIds: pairings
      .filter((pairing) => isPairingBlockedStatus(pairing.status))
      .map((pairing) => pairing.pairing_id),
    pendingIds: pairings
      .filter((pairing) => isPairingHumanActionableStatus(pairing.status))
      .map((pairing) => pairing.pairing_id),
  };
}

function upsertPairing(state: PairingState, pairing: Pairing): PairingState {
  const id = pairing.pairing_id;
  const byId = { ...state.byId, [id]: pairing };

  const shouldBeBlocked = isPairingBlockedStatus(pairing.status);
  const isBlocked = state.blockedIds.includes(id);
  let blockedIds = state.blockedIds;

  if (shouldBeBlocked && !isBlocked) {
    blockedIds = [...blockedIds, id];
  } else if (!shouldBeBlocked && isBlocked) {
    blockedIds = blockedIds.filter((entry) => entry !== id);
  }

  const shouldBePending = isPairingHumanActionableStatus(pairing.status);
  const isPending = state.pendingIds.includes(id);
  let pendingIds = state.pendingIds;

  if (shouldBePending && !isPending) {
    pendingIds = [...pendingIds, id];
  } else if (!shouldBePending && isPending) {
    pendingIds = pendingIds.filter((entry) => entry !== id);
  }

  return { ...state, byId, blockedIds, pendingIds };
}

function pairingFromMutation(result: PairingMutateResponse): Pairing {
  return result.pairing;
}

interface PairingRefreshState {
  runId: RefreshRunState["runId"];
  activeRunId: RefreshRunState["activeRunId"];
  bufferedUpserts: Map<number, Pairing>;
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
    for (const pairing of result.pairings) {
      byId[pairing.pairing_id] = pairing;
    }
    setState((prev) => {
      let next: PairingState = { ...prev, byId, ...collectPairingIds(result.pairings) };
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
  mutate: (http: OperatorHttpClient) => Promise<PairingMutateResponse>,
  http: OperatorHttpClient,
  getPrivilegedHttp: GetPrivilegedHttpClient | undefined,
  setState: SetState<PairingState>,
  refreshState: PairingRefreshState,
): Promise<Pairing> {
  const mutationHttp = getPrivilegedHttp?.();
  if (getPrivilegedHttp && !mutationHttp) {
    throw new ElevatedModeRequiredError("Authorize admin access to manage device pairings.");
  }

  const result = await mutate(mutationHttp ?? http);
  const pairing = pairingFromMutation(result);
  handlePairingUpsertImpl(setState, refreshState, pairing);
  return pairing;
}

export function createPairingStore(options: {
  http: OperatorHttpClient;
  getPrivilegedHttp?: GetPrivilegedHttpClient;
}): {
  store: PairingStore;
  handlePairingUpsert: (pairing: Pairing) => void;
} {
  const { store, setState } = createStore<PairingState>({
    byId: {},
    blockedIds: [],
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
      refresh: () => refreshImpl(options.http, setState, refreshState),
      approve: (pairingId, input) =>
        mutatePairingImpl(
          (http) => http.pairings.approve(pairingId, input),
          options.http,
          options.getPrivilegedHttp,
          setState,
          refreshState,
        ),
      deny: (pairingId, input) =>
        mutatePairingImpl(
          (http) => http.pairings.deny(pairingId, input),
          options.http,
          options.getPrivilegedHttp,
          setState,
          refreshState,
        ),
      revoke: (pairingId, input) =>
        mutatePairingImpl(
          (http) => http.pairings.revoke(pairingId, input),
          options.http,
          options.getPrivilegedHttp,
          setState,
          refreshState,
        ),
    },
    handlePairingUpsert: (pairing) => handlePairingUpsertImpl(setState, refreshState, pairing),
  };
}
