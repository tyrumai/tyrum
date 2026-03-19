import type { OperatorAuthStrategy } from "./auth.js";
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

  let core = createCore({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    auth: options.baselineAuth,
    elevatedModeStore: options.elevatedModeStore,
  });

  return {
    getCore() {
      return core;
    },
    subscribe(listener) {
      void listener;
      return () => {};
    },
    dispose() {
      core.dispose();
    },
  };
}
