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
  approve(pairingId: number, input: { trust_level: string; capability_allowlist: unknown[]; reason?: string }): Promise<Pairing>;
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

  function handlePairingUpsert(pairing: Pairing): void {
    setState((prev) => upsertPairing(prev, pairing));
  }

  async function refresh(): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await http.pairings.list();
      const byId: Record<number, Pairing> = {};
      const pendingIds: number[] = [];
      for (const pairing of result.pairings) {
        byId[pairing.pairing_id] = pairing;
        if (pairing.status === "pending") {
          pendingIds.push(pairing.pairing_id);
        }
      }
      setState((prev) => ({
        ...prev,
        byId,
        pendingIds,
        loading: false,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
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

