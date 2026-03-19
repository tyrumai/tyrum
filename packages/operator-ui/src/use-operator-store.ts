import type { ExternalStore } from "@tyrum/operator-app";
import { useSyncExternalStore } from "react";

export function useOperatorStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
