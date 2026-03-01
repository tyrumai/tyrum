export {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  httpAuthForAuth,
  selectAuthForAdminMode,
  wsTokenForAuth,
} from "./auth.js";
export type { OperatorAuthStrategy } from "./auth.js";

export { createGatewayAuthSession } from "./auth-session.js";

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

export type { OperatorCoreError, OperatorCoreErrorKind } from "./operator-error.js";

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
export type {
  MemoryBrowseRequest,
  MemoryBrowseResults,
  MemoryBrowseState,
  MemoryExportState,
  MemoryInspectState,
  MemoryState,
  MemoryStore,
  MemoryTombstonesState,
} from "./stores/memory-store.js";

// Re-exports for consumers (apps/desktop, packages/tui)
export type {
  ActionPrimitive,
  ClientCapability,
  EvaluationContext,
} from "@tyrum/schemas";
export { checkPostcondition, deviceIdFromSha256Digest } from "@tyrum/schemas";

export { TyrumClient, autoExecute, createTyrumHttpClient } from "@tyrum/client";
export type {
  CapabilityProvider,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  MemoryItem,
  TaskResult,
} from "@tyrum/client";
