export type Unsubscribe = () => void;

export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): Unsubscribe;
}

export function createStore<T>(initial: T): {
  store: ExternalStore<T>;
  setState: (updater: (prev: T) => T) => void;
} {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    store: {
      getSnapshot() {
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setState(updater) {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
