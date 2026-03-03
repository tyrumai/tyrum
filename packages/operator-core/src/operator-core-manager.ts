import { selectAuthForElevatedMode, type OperatorAuthStrategy } from "./auth.js";
import { createOperatorCore, type OperatorCore } from "./operator-core.js";
import type { ElevatedModeStore } from "./stores/elevated-mode-store.js";

export type OperatorCoreFactory = (options: {
  wsUrl: string;
  httpBaseUrl: string;
  auth: OperatorAuthStrategy;
  elevatedModeStore: ElevatedModeStore;
}) => OperatorCore;

export type OperatorCoreManagerOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  baselineAuth: OperatorAuthStrategy;
  elevatedModeStore: ElevatedModeStore;
  createCore?: OperatorCoreFactory;
};

export type OperatorCoreManager = {
  getCore(): OperatorCore;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

function isSameAuth(a: OperatorAuthStrategy, b: OperatorAuthStrategy): boolean {
  switch (a.type) {
    case "bearer-token":
      return b.type === "bearer-token" && a.token === b.token;
    case "browser-cookie":
      return b.type === "browser-cookie" && a.credentials === b.credentials;
    default:
      return false;
  }
}

function shouldReconnectCore(core: OperatorCore): boolean {
  const status = core.connectionStore.getSnapshot().status;
  return status === "connecting" || status === "connected";
}

export function createOperatorCoreManager(
  options: OperatorCoreManagerOptions,
): OperatorCoreManager {
  const createCore: OperatorCoreFactory =
    options.createCore ??
    ((coreOptions) =>
      createOperatorCore({
        wsUrl: coreOptions.wsUrl,
        httpBaseUrl: coreOptions.httpBaseUrl,
        auth: coreOptions.auth,
        elevatedModeStore: coreOptions.elevatedModeStore,
      }));

  let auth = selectAuthForElevatedMode({
    baseline: options.baselineAuth,
    elevatedMode: options.elevatedModeStore.getSnapshot(),
  });

  let core = createCore({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    auth,
    elevatedModeStore: options.elevatedModeStore,
  });

  const listeners = new Set<() => void>();
  const emit = (): void => {
    let firstError: unknown = null;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }
      }
    }
    if (firstError !== null) {
      throw firstError;
    }
  };

  const unsubElevatedMode = options.elevatedModeStore.subscribe(() => {
    const nextAuth = selectAuthForElevatedMode({
      baseline: options.baselineAuth,
      elevatedMode: options.elevatedModeStore.getSnapshot(),
    });
    if (isSameAuth(auth, nextAuth)) return;

    const prevCore = core;
    const reconnect = shouldReconnectCore(prevCore);

    core = createCore({
      wsUrl: options.wsUrl,
      httpBaseUrl: options.httpBaseUrl,
      auth: nextAuth,
      elevatedModeStore: options.elevatedModeStore,
    });
    auth = nextAuth;

    prevCore.dispose();

    if (reconnect) {
      core.connect();
    }

    emit();
  });

  return {
    getCore() {
      return core;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubElevatedMode();
      core.dispose();
      listeners.clear();
    },
  };
}
