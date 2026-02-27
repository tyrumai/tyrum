import {
  createOperatorCore,
  selectAuthForAdminMode,
  type AdminModeStore,
  type OperatorAuthStrategy,
  type OperatorCore,
} from "@tyrum/operator-core";

export type WebOperatorCoreFactory = (options: {
  wsUrl: string;
  httpBaseUrl: string;
  auth: OperatorAuthStrategy;
  adminModeStore: AdminModeStore;
}) => OperatorCore;

export type WebOperatorCoreManagerOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  baselineAuth: OperatorAuthStrategy;
  adminModeStore: AdminModeStore;
  createCore?: WebOperatorCoreFactory;
};

export type WebOperatorCoreManager = {
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

export function createWebOperatorCoreManager(
  options: WebOperatorCoreManagerOptions,
): WebOperatorCoreManager {
  const createCore: WebOperatorCoreFactory =
    options.createCore ??
    ((coreOptions) =>
      createOperatorCore({
        wsUrl: coreOptions.wsUrl,
        httpBaseUrl: coreOptions.httpBaseUrl,
        auth: coreOptions.auth,
        adminModeStore: coreOptions.adminModeStore,
      }));

  let auth = selectAuthForAdminMode({
    baseline: options.baselineAuth,
    adminMode: options.adminModeStore.getSnapshot(),
  });

  let core = createCore({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    auth,
    adminModeStore: options.adminModeStore,
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

  const unsubAdminMode = options.adminModeStore.subscribe(() => {
    const nextAuth = selectAuthForAdminMode({
      baseline: options.baselineAuth,
      adminMode: options.adminModeStore.getSnapshot(),
    });
    if (isSameAuth(auth, nextAuth)) return;

    const prevCore = core;
    const reconnect = shouldReconnectCore(prevCore);

    core = createCore({
      wsUrl: options.wsUrl,
      httpBaseUrl: options.httpBaseUrl,
      auth: nextAuth,
      adminModeStore: options.adminModeStore,
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
      unsubAdminMode();
      core.dispose();
      listeners.clear();
    },
  };
}
