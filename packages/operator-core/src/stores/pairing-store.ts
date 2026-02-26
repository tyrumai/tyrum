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
    input: { trust_level: string; capability_allowlist: unknown[]; reason?: string },
  ): Promise<Pairing>;
  deny(pairingId: number, input?: { reason?: string }): Promise<Pairing>;
  revoke(pairingId: number, input?: { reason?: string }): Promise<Pairing>;
}

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

  let refreshRunId = 0;
  let activeRefreshRunId: number | null = null;
  let bufferedPairingUpserts = new Map<number, Pairing>();

  function handlePairingUpsert(pairing: Pairing): void {
    if (activeRefreshRunId !== null) {
      bufferedPairingUpserts.set(pairing.pairing_id, pairing);
    }
    setState((prev) => upsertPairing(prev, pairing));
  }

  async function refresh(): Promise<void> {
    const runId = ++refreshRunId;
    activeRefreshRunId = runId;
    bufferedPairingUpserts = new Map<number, Pairing>();

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await http.pairings.list();
      if (activeRefreshRunId !== runId) return;
      const buffered = bufferedPairingUpserts;

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
      if (activeRefreshRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (activeRefreshRunId === runId) {
        activeRefreshRunId = null;
        bufferedPairingUpserts = new Map<number, Pairing>();
      }
    }
  }

  async function approve(
    pairingId: number,
    input: { trust_level: string; capability_allowlist: unknown[]; reason?: string },
  ): Promise<Pairing> {
    const result = await http.pairings.approve(pairingId, input);
    const pairing = pairingFromMutation(result);
    handlePairingUpsert(pairing);
    return pairing;
  }

  async function deny(pairingId: number, input?: { reason?: string }): Promise<Pairing> {
    const result = await http.pairings.deny(pairingId, input);
    const pairing = pairingFromMutation(result);
    handlePairingUpsert(pairing);
    return pairing;
  }

  async function revoke(pairingId: number, input?: { reason?: string }): Promise<Pairing> {
    const result = await http.pairings.revoke(pairingId, input);
    const pairing = pairingFromMutation(result);
    handlePairingUpsert(pairing);
    return pairing;
  }

  return {
    store: {
      ...store,
      refresh,
      approve,
      deny,
      revoke,
    },
    handlePairingUpsert,
  };
}
