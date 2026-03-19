import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ElevatedModeRequiredError,
  createElevatedModeStore,
  createBearerTokenAuth,
  gateElevatedMode,
  isElevatedModeActive,
  formatElevatedModeRemaining,
  requireElevatedMode,
  selectAuthForElevatedMode,
  type ElevatedModeState,
} from "../src/index.js";

describe("elevated mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-expires and reverts auth selection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T00:00:00.000Z"));

    const store = createElevatedModeStore();
    const baseline = createBearerTokenAuth("baseline-token");

    expect(isElevatedModeActive(store.getSnapshot())).toBe(false);
    expect(selectAuthForElevatedMode({ baseline, elevatedMode: store.getSnapshot() })).toEqual(
      baseline,
    );

    const expiresAt = new Date(Date.now() + 5_000).toISOString();
    store.enter({ elevatedToken: "elevated-token", expiresAt });

    expect(isElevatedModeActive(store.getSnapshot())).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-token",
      expiresAt,
    });
    expect(selectAuthForElevatedMode({ baseline, elevatedMode: store.getSnapshot() })).toEqual({
      type: "bearer-token",
      token: "elevated-token",
    });

    const initialRemainingMs = store.getSnapshot().remainingMs;
    expect(initialRemainingMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(1_000);
    expect(store.getSnapshot().remainingMs).toBeLessThan(initialRemainingMs);

    vi.advanceTimersByTime(5_000);

    expect(isElevatedModeActive(store.getSnapshot())).toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      status: "inactive",
      elevatedToken: null,
      expiresAt: null,
    });
    expect(selectAuthForElevatedMode({ baseline, elevatedMode: store.getSnapshot() })).toEqual(
      baseline,
    );
  });

  it("supports persistent elevated mode without scheduling timers", () => {
    vi.useFakeTimers();

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      const store = createElevatedModeStore();
      const baseline = createBearerTokenAuth("baseline-token");

      store.enter({ elevatedToken: "persistent-token", expiresAt: null });

      expect(isElevatedModeActive(store.getSnapshot())).toBe(true);
      expect(store.getSnapshot()).toMatchObject({
        status: "active",
        elevatedToken: "persistent-token",
        expiresAt: null,
        remainingMs: null,
      });
      expect(selectAuthForElevatedMode({ baseline, elevatedMode: store.getSnapshot() })).toEqual({
        type: "bearer-token",
        token: "persistent-token",
      });
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });

  it("does not select elevated auth when elevated mode is expired", () => {
    const baseline = createBearerTokenAuth("baseline-token");
    const elevatedMode = {
      status: "active",
      elevatedToken: "elevated-token",
      enteredAt: null,
      expiresAt: "2026-02-26T00:00:05.000Z",
      remainingMs: 0,
    } satisfies ElevatedModeState;

    expect(isElevatedModeActive(elevatedMode)).toBe(false);
    expect(selectAuthForElevatedMode({ baseline, elevatedMode })).toEqual(baseline);
  });

  it("does not emit a transient active state with zero remainingMs", () => {
    vi.useFakeTimers();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      let nowMs = Date.parse("2026-02-26T00:00:00.000Z");
      const store = createElevatedModeStore({ tickIntervalMs: 1_000, now: () => nowMs });

      const emitted: ElevatedModeState[] = [];
      store.subscribe(() => {
        emitted.push(store.getSnapshot());
      });

      const expiresAt = new Date(nowMs + 1_000).toISOString();
      store.enter({ elevatedToken: "elevated-token", expiresAt });

      const intervalCall = setIntervalSpy.mock.calls.find((call) => call[1] === 1_000);
      if (!intervalCall)
        throw new Error("Expected createElevatedModeStore to schedule a tick timer");
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
      const store = createElevatedModeStore({ tickIntervalMs: 0, now });

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
      const store = createElevatedModeStore({ tickIntervalMs: 0 });

      const expiresAt = new Date(Date.now() + MAX_SET_TIMEOUT_MS + 10_000).toISOString();
      store.enter({ elevatedToken: "elevated-token", expiresAt });

      expect(store.getSnapshot().status).toBe("active");

      const lastTimeoutCall = setTimeoutSpy.mock.calls.at(-1);
      if (!lastTimeoutCall)
        throw new Error("Expected createElevatedModeStore to schedule an expiry timer");

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

    const store = createElevatedModeStore();

    expect(() => requireElevatedMode(store.getSnapshot())).toThrow(ElevatedModeRequiredError);
    await expect(gateElevatedMode(store, async () => "ok")).rejects.toBeInstanceOf(
      ElevatedModeRequiredError,
    );

    const expiresAt = new Date(Date.now() + 5_000).toISOString();
    store.enter({ elevatedToken: "elevated-token", expiresAt });

    expect(() => requireElevatedMode(store.getSnapshot())).not.toThrow();
    await expect(gateElevatedMode(store, async () => "ok")).resolves.toBe("ok");
  });

  it("formats elevated mode remaining time as m:ss", () => {
    expect(
      formatElevatedModeRemaining({
        expiresAt: "2026-02-26T00:01:01.000Z",
        remainingMs: 61_000,
      }),
    ).toBe("1:01");
  });

  it("falls back to expiresAt when remainingMs is null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-26T00:00:00.000Z"));

    expect(
      formatElevatedModeRemaining({
        expiresAt: "2026-02-26T00:01:01.000Z",
        remainingMs: null,
      }),
    ).toBe("1:01");
  });

  it("returns placeholder remaining time for persistent elevated mode", () => {
    expect(
      formatElevatedModeRemaining({
        expiresAt: null,
        remainingMs: null,
      }),
    ).toBe("--:--");
  });
});
