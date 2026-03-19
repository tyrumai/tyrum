import { describe, expect, it, vi } from "vitest";
import { ElevatedModeRequiredError } from "../src/elevated-mode.js";
import { createPairingStore, type Pairing } from "../src/stores/pairing-store.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pairing(pairingId: number, status: Pairing["status"]): Pairing {
  return {
    pairing_id: pairingId,
    motivation: "A node wants to connect.",
    trust_level: "local",
    status,
    requested_at: "2026-03-09T00:00:00.000Z",
    node: {
      node_id: `node-${pairingId}`,
      label: `Node ${pairingId}`,
      capabilities: [],
      last_seen_at: "2026-03-09T00:00:00.000Z",
    },
    capability_allowlist: [],
    latest_review:
      status === "awaiting_human"
        ? {
            review_id: `review-${pairingId}`,
            target_type: "pairing",
            target_id: String(pairingId),
            reviewer_kind: "human",
            reviewer_id: null,
            state: "requested_human",
            reason: null,
            risk_level: null,
            risk_score: null,
            evidence: null,
            decision_payload: null,
            created_at: "2026-03-09T00:00:00.000Z",
            started_at: null,
            completed_at: null,
          }
        : {
            review_id: `review-${pairingId}`,
            target_type: "pairing",
            target_id: String(pairingId),
            reviewer_kind: "human",
            reviewer_id: null,
            state: status === "approved" ? "approved" : status === "denied" ? "denied" : "revoked",
            reason: status,
            risk_level: null,
            risk_score: null,
            evidence: null,
            decision_payload: null,
            created_at: "2026-03-09T00:00:00.000Z",
            started_at: "2026-03-09T00:00:00.500Z",
            completed_at: "2026-03-09T00:00:01.000Z",
          },
  };
}

function createHttp() {
  return {
    pairings: {
      list: vi.fn<() => Promise<{ pairings: Pairing[] }>>(),
      approve: vi.fn<
        (
          pairingId: number,
          input: {
            trust_level: "local" | "remote";
            capability_allowlist: Pairing["capability_allowlist"];
          },
        ) => Promise<{ pairing: Pairing }>
      >(),
      deny: vi.fn<
        (pairingId: number, input?: { reason?: string }) => Promise<{ pairing: Pairing }>
      >(),
      revoke:
        vi.fn<(pairingId: number, input?: { reason?: string }) => Promise<{ pairing: Pairing }>>(),
    },
  };
}

describe("pairing-store", () => {
  it("refreshes pairings and records the sync timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T09:30:00.000Z"));
    const http = createHttp();
    http.pairings.list.mockResolvedValue({
      pairings: [pairing(1, "awaiting_human"), pairing(2, "approved")],
    });

    const { store } = createPairingStore({ http: http as never });
    await store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      byId: {
        1: pairing(1, "awaiting_human"),
        2: pairing(2, "approved"),
      },
      blockedIds: [1],
      pendingIds: [1],
      loading: false,
      error: null,
      lastSyncedAt: "2026-03-09T09:30:00.000Z",
    });
    vi.useRealTimers();
  });

  it("preserves buffered upserts that arrive during a refresh", async () => {
    const pending = deferred<{ pairings: Pairing[] }>();
    const http = createHttp();
    http.pairings.list.mockImplementation(async () => await pending.promise);

    const { store, handlePairingUpsert } = createPairingStore({ http: http as never });
    const refreshPromise = store.refresh();

    handlePairingUpsert(pairing(3, "approved"));
    expect(store.getSnapshot().byId[3]?.status).toBe("approved");

    pending.resolve({ pairings: [pairing(3, "awaiting_human")] });
    await refreshPromise;

    expect(store.getSnapshot().byId[3]?.status).toBe("approved");
    expect(store.getSnapshot().pendingIds).toEqual([]);
  });

  it("surfaces refresh errors without leaving the store loading", async () => {
    const http = createHttp();
    http.pairings.list.mockRejectedValue(new Error("pairing list failed"));

    const { store } = createPairingStore({ http: http as never });
    await store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      loading: false,
      error: "pairing list failed",
    });
  });

  it("applies approve, deny, and revoke mutations to the store", async () => {
    const http = createHttp();
    http.pairings.approve.mockResolvedValue({ pairing: pairing(4, "approved") });
    http.pairings.deny.mockResolvedValue({ pairing: pairing(5, "denied") });
    http.pairings.revoke.mockResolvedValue({ pairing: pairing(6, "revoked") });

    const { store } = createPairingStore({ http: http as never });

    await expect(
      store.approve(4, { trust_level: "local", capability_allowlist: [] }),
    ).resolves.toEqual(pairing(4, "approved"));
    await expect(store.deny(5, { reason: "mismatch" })).resolves.toEqual(pairing(5, "denied"));
    await expect(store.revoke(6, { reason: "rotated" })).resolves.toEqual(pairing(6, "revoked"));

    expect(http.pairings.approve).toHaveBeenCalledWith(4, {
      trust_level: "local",
      capability_allowlist: [],
    });
    expect(http.pairings.deny).toHaveBeenCalledWith(5, { reason: "mismatch" });
    expect(http.pairings.revoke).toHaveBeenCalledWith(6, { reason: "rotated" });
    expect(store.getSnapshot().pendingIds).toEqual([]);
    expect(store.getSnapshot().byId).toMatchObject({
      4: pairing(4, "approved"),
      5: pairing(5, "denied"),
      6: pairing(6, "revoked"),
    });
  });

  it("uses the privileged HTTP client for pairing mutations when provided", async () => {
    const baselineHttp = createHttp();
    const privilegedHttp = createHttp();
    privilegedHttp.pairings.approve.mockResolvedValue({ pairing: pairing(7, "approved") });

    const { store } = createPairingStore({
      http: baselineHttp as never,
      getPrivilegedHttp: () => privilegedHttp as never,
    });

    await expect(store.approve(7, { note: "approved via admin access" })).resolves.toEqual(
      pairing(7, "approved"),
    );

    expect(privilegedHttp.pairings.approve).toHaveBeenCalledWith(7, {
      note: "approved via admin access",
    });
    expect(baselineHttp.pairings.approve).not.toHaveBeenCalled();
  });

  it("requires admin access when pairing mutations are gated on a privileged HTTP client", async () => {
    const http = createHttp();
    const { store } = createPairingStore({
      http: http as never,
      getPrivilegedHttp: () => null,
    });

    await expect(store.approve(8, { note: "missing admin" })).rejects.toThrow(
      ElevatedModeRequiredError,
    );
    expect(http.pairings.approve).not.toHaveBeenCalled();
  });
});
