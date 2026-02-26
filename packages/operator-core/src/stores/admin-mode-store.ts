import { createStore, type ExternalStore } from "../store.js";

export type AdminModeStatus = "inactive" | "active";

export interface AdminModeState {
  status: AdminModeStatus;
  elevatedToken: string | null;
  enteredAt: string | null;
  expiresAt: string | null;
  remainingMs: number | null;
}

export interface AdminModeStore extends ExternalStore<AdminModeState> {
  enter(input: { elevatedToken: string; expiresAt: string }): void;
  exit(): void;
  dispose(): void;
}

function parseExpiresAtMs(expiresAt: string): number {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) {
    throw new Error("Invalid expiresAt: must be an ISO datetime string");
  }
  return ms;
}

function toRemainingMs(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, expiresAtMs - nowMs);
}

export function createAdminModeStore(options?: {
  tickIntervalMs?: number;
  now?: () => number;
}): AdminModeStore {
  const tickIntervalMs = options?.tickIntervalMs ?? 1_000;
  const now = options?.now ?? (() => Date.now());

  const { store, setState } = createStore<AdminModeState>({
    status: "inactive",
    elevatedToken: null,
    enteredAt: null,
    expiresAt: null,
    remainingMs: null,
  });

  let expiresAtMs: number | null = null;
  let expireTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const clearTimers = (): void => {
    if (expireTimer) {
      clearTimeout(expireTimer);
      expireTimer = null;
    }
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const setInactive = (): void => {
    clearTimers();
    expiresAtMs = null;
    setState((prev) => {
      if (
        prev.status === "inactive" &&
        prev.elevatedToken === null &&
        prev.enteredAt === null &&
        prev.expiresAt === null &&
        prev.remainingMs === null
      ) {
        return prev;
      }
      return {
        status: "inactive",
        elevatedToken: null,
        enteredAt: null,
        expiresAt: null,
        remainingMs: null,
      };
    });
  };

  const syncRemaining = (): void => {
    if (expiresAtMs === null) return;
    const remainingMs = toRemainingMs(expiresAtMs, now());
    setState((prev) => {
      if (prev.status !== "active") return prev;
      if (prev.remainingMs === remainingMs) return prev;
      return { ...prev, remainingMs };
    });
    if (remainingMs === 0) {
      setInactive();
    }
  };

  const startTimers = (): void => {
    if (expiresAtMs === null) return;

    const remainingMs = toRemainingMs(expiresAtMs, now());
    if (remainingMs === 0) {
      setInactive();
      return;
    }

    clearTimers();

    expireTimer = setTimeout(() => {
      setInactive();
    }, remainingMs);
    (expireTimer as unknown as { unref?: () => void }).unref?.();

    if (tickIntervalMs > 0) {
      tickTimer = setInterval(() => {
        syncRemaining();
      }, tickIntervalMs);
      (tickTimer as unknown as { unref?: () => void }).unref?.();
    }
  };

  const enter = (input: { elevatedToken: string; expiresAt: string }): void => {
    const elevatedToken = input.elevatedToken.trim();
    if (!elevatedToken) {
      throw new Error("elevatedToken is required");
    }

    const expiresAt = input.expiresAt.trim();
    if (!expiresAt) {
      throw new Error("expiresAt is required");
    }

    const nextExpiresAtMs = parseExpiresAtMs(expiresAt);
    const enteredAt = new Date(now()).toISOString();
    const remainingMs = toRemainingMs(nextExpiresAtMs, now());

    if (remainingMs === 0) {
      setInactive();
      return;
    }

    expiresAtMs = nextExpiresAtMs;

    setState((prev) => ({
      ...prev,
      status: "active",
      elevatedToken,
      enteredAt,
      expiresAt,
      remainingMs,
    }));

    startTimers();
  };

  const exit = (): void => {
    setInactive();
  };

  const dispose = (): void => {
    setInactive();
  };

  return {
    ...store,
    enter,
    exit,
    dispose,
  };
}
