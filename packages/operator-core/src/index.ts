export {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  httpAuthForAuth,
  selectAuthForAdminMode,
  wsTokenForAuth,
} from "./auth.js";
export type { OperatorAuthStrategy } from "./auth.js";

export {
  AdminModeRequiredError,
  gateAdminMode,
  formatAdminModeRemaining,
  isAdminModeActive,
  requireAdminMode,
} from "./admin-mode.js";

export { createOperatorCore } from "./operator-core.js";
export type { OperatorCore, OperatorCoreOptions } from "./operator-core.js";

export {
  createOperatorCoreManager,
  type OperatorCoreFactory,
  type OperatorCoreManager,
  type OperatorCoreManagerOptions,
} from "./operator-core-manager.js";

export type { OperatorHttpClient, OperatorWsClient } from "./deps.js";

export type { ExternalStore, Unsubscribe } from "./store.js";

export {
  createAdminModeStore,
  type AdminModeState,
  type AdminModeStatus,
  type AdminModeStore,
} from "./stores/admin-mode-store.js";

export type { ApprovalsState, ApprovalsStore } from "./stores/approvals-store.js";
export type { ConnectionState, ConnectionStore } from "./stores/connection-store.js";
export type { Pairing, PairingState, PairingStore } from "./stores/pairing-store.js";
export type { RunsState, RunsStore } from "./stores/runs-store.js";
export type { OperatorPresenceEntry, StatusState, StatusStore } from "./stores/status-store.js";
