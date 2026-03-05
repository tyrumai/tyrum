import { createStore, type ExternalStore } from "../store.js";

export type ElevatedModeStatus = "inactive" | "active";

export interface ElevatedModeState {
  status: ElevatedModeStatus;
  elevatedToken: string | null;
  enteredAt: string | null;
  expiresAt: string | null;
  remainingMs: number | null;
}

export interface ElevatedModeStore extends ExternalStore<ElevatedModeState> {
  enter(input: { elevatedToken: string; expiresAt: string }): void;
  exit(): void;
  dispose(): void;
}

type SetState<T> = (updater: (prev: T) => T) => void;

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

const MAX_SET_TIMEOUT_MS = 2_147_483_647;

interface ElevatedModeRuntime {
  tickIntervalMs: number;
  now: () => number;
  setState: SetState<ElevatedModeState>;
  expiresAtMs: number | null;
  expireTimer: ReturnType<typeof setTimeout> | null;
  tickTimer: ReturnType<typeof setInterval> | null;
}

function unrefTimer(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

function clearTimers(runtime: ElevatedModeRuntime): void {
  if (runtime.expireTimer) {
    clearTimeout(runtime.expireTimer);
    runtime.expireTimer = null;
  }
  if (runtime.tickTimer) {
    clearInterval(runtime.tickTimer);
    runtime.tickTimer = null;
  }
}

function setInactive(runtime: ElevatedModeRuntime): void {
  clearTimers(runtime);
  runtime.expiresAtMs = null;
  runtime.setState((prev) => {
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
}

function syncRemaining(runtime: ElevatedModeRuntime): void {
  if (runtime.expiresAtMs === null) return;
  const remainingMs = toRemainingMs(runtime.expiresAtMs, runtime.now());
  if (remainingMs === 0) {
    setInactive(runtime);
    return;
  }
  runtime.setState((prev) => {
    if (prev.status !== "active") return prev;
    if (prev.remainingMs === remainingMs) return prev;
    return { ...prev, remainingMs };
  });
}

function startTimers(runtime: ElevatedModeRuntime, remainingMs: number): void {
  if (runtime.expiresAtMs === null) return;

  if (remainingMs === 0) {
    setInactive(runtime);
    return;
  }

  clearTimers(runtime);

  runtime.expireTimer = setTimeout(
    () => {
      if (runtime.expiresAtMs === null) return;
      const nextRemainingMs = toRemainingMs(runtime.expiresAtMs, runtime.now());
      startTimers(runtime, nextRemainingMs);
    },
    Math.min(remainingMs, MAX_SET_TIMEOUT_MS),
  );
  unrefTimer(runtime.expireTimer);

  if (runtime.tickIntervalMs > 0) {
    runtime.tickTimer = setInterval(() => {
      syncRemaining(runtime);
    }, runtime.tickIntervalMs);
    unrefTimer(runtime.tickTimer);
  }
}

function enterImpl(
  runtime: ElevatedModeRuntime,
  input: { elevatedToken: string; expiresAt: string },
): void {
  const elevatedToken = input.elevatedToken.trim();
  if (!elevatedToken) {
    throw new Error("elevatedToken is required");
  }

  const expiresAt = input.expiresAt.trim();
  if (!expiresAt) {
    throw new Error("expiresAt is required");
  }

  const nowMs = runtime.now();
  const nextExpiresAtMs = parseExpiresAtMs(expiresAt);
  const enteredAt = new Date(nowMs).toISOString();
  const remainingMs = toRemainingMs(nextExpiresAtMs, nowMs);

  if (remainingMs === 0) {
    setInactive(runtime);
    return;
  }

  runtime.expiresAtMs = nextExpiresAtMs;

  startTimers(runtime, remainingMs);

  runtime.setState((prev) => ({
    ...prev,
    status: "active",
    elevatedToken,
    enteredAt,
    expiresAt,
    remainingMs,
  }));
}

export function createElevatedModeStore(options?: {
  tickIntervalMs?: number;
  now?: () => number;
}): ElevatedModeStore {
  const tickIntervalMs = options?.tickIntervalMs ?? 1_000;
  const now = options?.now ?? (() => Date.now());

  const { store, setState } = createStore<ElevatedModeState>({
    status: "inactive",
    elevatedToken: null,
    enteredAt: null,
    expiresAt: null,
    remainingMs: null,
  });

  const runtime: ElevatedModeRuntime = {
    tickIntervalMs,
    now,
    setState,
    expiresAtMs: null,
    expireTimer: null,
    tickTimer: null,
  };

  return {
    ...store,
    enter: (input) => enterImpl(runtime, input),
    exit: () => setInactive(runtime),
    dispose: () => setInactive(runtime),
  };
}
