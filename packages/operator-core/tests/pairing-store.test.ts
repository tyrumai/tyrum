import { describe, expect, it, vi } from "vitest";
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
    tenant_id: "tenant-1",
    token_id: "token-1",
    challenge_code: "123456",
    status,
    requested_by_user_id: "user-1",
    requested_at: "2026-03-09T00:00:00.000Z",
    approved_by_user_id: null,
    approved_at: null,
    denied_by_user_id: null,
    denied_at: null,
    revoked_by_user_id: null,
    revoked_at: null,
    expires_at: "2026-03-10T00:00:00.000Z",
  };
}

function createHttp() {
  return {
    pairings: {
      list: vi.fn<() => Promise<{ pairings: Pairing[] }>>(),
      approve:
        vi.fn<(pairingId: number, input: { note: string }) => Promise<{ pairing: Pairing }>>(),
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
      pairings: [pairing(1, "pending"), pairing(2, "approved")],
    });

    const { store } = createPairingStore(http as never);
    await store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      byId: {
        1: pairing(1, "pending"),
        2: pairing(2, "approved"),
      },
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

    const { store, handlePairingUpsert } = createPairingStore(http as never);
    const refreshPromise = store.refresh();

    handlePairingUpsert(pairing(3, "approved"));
    expect(store.getSnapshot().byId[3]?.status).toBe("approved");

    pending.resolve({ pairings: [pairing(3, "pending")] });
    await refreshPromise;

    expect(store.getSnapshot().byId[3]?.status).toBe("approved");
    expect(store.getSnapshot().pendingIds).toEqual([]);
  });

  it("surfaces refresh errors without leaving the store loading", async () => {
    const http = createHttp();
    http.pairings.list.mockRejectedValue(new Error("pairing list failed"));

    const { store } = createPairingStore(http as never);
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

    const { store } = createPairingStore(http as never);

    await expect(store.approve(4, { note: "looks good" })).resolves.toEqual(pairing(4, "approved"));
    await expect(store.deny(5, { reason: "mismatch" })).resolves.toEqual(pairing(5, "denied"));
    await expect(store.revoke(6, { reason: "rotated" })).resolves.toEqual(pairing(6, "revoked"));

    expect(http.pairings.approve).toHaveBeenCalledWith(4, { note: "looks good" });
    expect(http.pairings.deny).toHaveBeenCalledWith(5, { reason: "mismatch" });
    expect(http.pairings.revoke).toHaveBeenCalledWith(6, { reason: "rotated" });
    expect(store.getSnapshot().pendingIds).toEqual([]);
    expect(store.getSnapshot().byId).toMatchObject({
      4: pairing(4, "approved"),
      5: pairing(5, "denied"),
      6: pairing(6, "revoked"),
    });
  });
});
