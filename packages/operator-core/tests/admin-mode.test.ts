import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminModeRequiredError,
  createAdminModeStore,
  createBearerTokenAuth,
  gateAdminMode,
  isAdminModeActive,
  requireAdminMode,
  selectAuthForAdminMode,
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
});
