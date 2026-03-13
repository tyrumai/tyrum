import type { OperatorCore, OperatorCoreManager } from "@tyrum/operator-core";
import { useSyncExternalStore } from "react";
import type { TuiKey } from "./tui-input.js";

export const MAX_RUNS_VISIBLE = 20;

export function useOperatorStore<T>(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useOperatorCoreManager(manager: OperatorCoreManager): OperatorCore {
  return useSyncExternalStore(
    (listener) => manager.subscribe(listener),
    () => manager.getCore(),
    () => manager.getCore(),
  );
}

export function toTuiKey(key: unknown): TuiKey {
  if (!key || typeof key !== "object" || Array.isArray(key)) return {};
  const rec = key as Record<string, unknown>;
  return {
    ctrl: rec["ctrl"] === true,
    upArrow: rec["upArrow"] === true,
    downArrow: rec["downArrow"] === true,
  };
}

export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function maskToken(token: string): string {
  if (!token) return "";
  const max = 24;
  if (token.length <= max) return "•".repeat(token.length);
  return `${"•".repeat(max)}…`;
}

export function getPairingIds(
  pairing: ReturnType<OperatorCore["pairingStore"]["getSnapshot"]>,
): number[] {
  const ids = Object.keys(pairing.byId)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  const pending = new Set(pairing.pendingIds);
  ids.sort((a, b) => {
    const aPending = pending.has(a);
    const bPending = pending.has(b);
    if (aPending !== bPending) return aPending ? -1 : 1;
    return a - b;
  });
  return ids;
}
