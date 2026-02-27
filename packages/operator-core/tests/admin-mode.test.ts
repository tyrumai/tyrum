import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminModeRequiredError,
  createAdminModeStore,
  createBearerTokenAuth,
  gateAdminMode,
  isAdminModeActive,
  formatAdminModeRemaining,
  requireAdminMode,
  selectAuthForAdminMode,
  type AdminModeState,
} from "../src/index.js";

describe("admin mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-expires and reverts auth selection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T00:00:00.000Z"));

    const store = createAdminModeStore();
    const baseline = createBearerTokenAuth("baseline-token");

    expect(isAdminModeActive(store.getSnapshot())).toBe(false);
    expect(selectAuthForAdminMode({ baseline, adminMode: store.getSnapshot() })).toEqual(baseline);

    const expiresAt = new Date(Date.now() + 5_000).toISOString();
    store.enter({ elevatedToken: "elevated-token", expiresAt });

    expect(isAdminModeActive(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-token",
      expiresAt,
    });
    expect(selectAuthForAdminMode({ baseline, adminMode: store.getSnapshot() })).toEqual({
      type: "bearer-token",
      token: "elevated-token",
    });

    const initialRemainingMs = store.getSnapshot().remainingMs;
    expect(initialRemainingMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(1_000);
    expect(store.getSnapshot().remainingMs).toBeLessThan(initialRemainingMs);

    vi.advanceTimersByTime(5_000);

    expect(isAdminModeActive(store.getSnapshot())).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      status: "inactive",
      elevatedToken: null,
      expiresAt: null,
    });
    expect(selectAuthForAdminMode({ baseline, adminMode: store.getSnapshot() })).toEqual(baseline);
  });

  it("does not select elevated auth when admin mode is expired", () => {
    const baseline = createBearerTokenAuth("baseline-token");
    const adminMode = {
      status: "active",
      elevatedToken: "elevated-token",
      enteredAt: null,
      expiresAt: "2026-02-26T00:00:05.000Z",
      remainingMs: 0,
    } satisfies AdminModeState;

    expect(isAdminModeActive(adminMode)).toBe(false);
    expect(selectAuthForAdminMode({ baseline, adminMode })).toEqual(baseline);
  });

  it("does not emit a transient active state with zero remainingMs", () => {
    vi.useFakeTimers();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      let nowMs = Date.parse("2026-02-26T00:00:00.000Z");
      const store = createAdminModeStore({ tickIntervalMs: 1_000, now: () => nowMs });

      const emitted: AdminModeState[] = [];
      store.subscribe(() => {
        emitted.push(store.getSnapshot());
      });

      const expiresAt = new Date(nowMs + 1_000).toISOString();
      store.enter({ elevatedToken: "elevated-token", expiresAt });

      const intervalCall = setIntervalSpy.mock.calls.find((call) => call[1] === 1_000);
      if (!intervalCall) throw new Error("Expected createAdminModeStore to schedule a tick timer");
      const intervalCallback = intervalCall[0] as () => void;

      nowMs += 1_000;
      intervalCallback();

      expect(emitted.some((state) => state.status === "active" && state.remainingMs === 0)).toBe(
        false,
      );

      store.dispose();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("uses a consistent now() for enteredAt, remainingMs, and expiry timer", () => {
    vi.useFakeTimers();

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      let nowCalls = 0;
      const now = vi.fn(() => nowCalls++ * 1_000);
      const store = createAdminModeStore({ tickIntervalMs: 0, now });

      const expiresAtMs = 10_000;
      store.enter({
        elevatedToken: "elevated-token",
        expiresAt: new Date(expiresAtMs).toISOString(),
      });

      const snapshot = store.getSnapshot();

      expect(now).toHaveBeenCalledTimes(1);
      expect(Date.parse(snapshot.enteredAt!)).toBe(0);
      expect(snapshot.remainingMs).toBe(expiresAtMs);
      expect(Date.parse(snapshot.enteredAt!) + snapshot.remainingMs!).toBe(
        Date.parse(snapshot.expiresAt!),
      );
      expect(setTimeoutSpy.mock.calls.some((call) => call[1] === snapshot.remainingMs)).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("chunks expiry timers to avoid setTimeout overflow for large TTLs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("1970-01-01T00:00:00.000Z"));

    const MAX_SET_TIMEOUT_MS = 2_147_483_647;

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const store = createAdminModeStore({ tickIntervalMs: 0 });

      const expiresAt = new Date(Date.now() + MAX_SET_TIMEOUT_MS + 10_000).toISOString();
      store.enter({ elevatedToken: "elevated-token", expiresAt });

      expect(store.getSnapshot().status).toBe("active");

      const lastTimeoutCall = setTimeoutSpy.mock.calls.at(-1);
      if (!lastTimeoutCall)
        throw new Error("Expected createAdminModeStore to schedule an expiry timer");

      const delayMs = lastTimeoutCall[1] as number;
      expect(delayMs).toBeLessThanOrEqual(MAX_SET_TIMEOUT_MS);

      vi.advanceTimersByTime(MAX_SET_TIMEOUT_MS);
      expect(store.getSnapshot().status).toBe("active");
      expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 10_000)).toBe(true);

      vi.advanceTimersByTime(10_000);
      expect(store.getSnapshot().status).toBe("inactive");

      store.dispose();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("provides gating helpers for dangerous actions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T00:00:00.000Z"));

    const store = createAdminModeStore();

    expect(() => requireAdminMode(store.getSnapshot())).toThrow(AdminModeRequiredError);
    await expect(gateAdminMode(store, async () => "ok")).rejects.toBeInstanceOf(
      AdminModeRequiredError,
    );

    const expiresAt = new Date(Date.now() + 5_000).toISOString();
    store.enter({ elevatedToken: "elevated-token", expiresAt });

    expect(() => requireAdminMode(store.getSnapshot())).not.toThrow();
    await expect(gateAdminMode(store, async () => "ok")).resolves.toBe("ok");
  });

  it("formats admin mode remaining time as m:ss", () => {
    expect(
      formatAdminModeRemaining({
        expiresAt: "2026-02-26T00:01:01.000Z",
        remainingMs: 61_000,
      }),
    ).toBe("1:01");
  });

  it("falls back to expiresAt when remainingMs is null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T00:00:00.000Z"));

    expect(
      formatAdminModeRemaining({
        expiresAt: "2026-02-26T00:01:01.000Z",
        remainingMs: null,
      }),
    ).toBe("1:01");
  });
});
