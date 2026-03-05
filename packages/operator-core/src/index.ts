export {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  httpAuthForAuth,
  selectAuthForElevatedMode,
  wsTokenForAuth,
} from "./auth.js";
export type { OperatorAuthStrategy } from "./auth.js";

export { createGatewayAuthSession } from "./auth-session.js";

export { createAutoSyncManager } from "./auto-sync.js";
export type {
  AutoSyncManager,
  AutoSyncState,
  AutoSyncTask,
  AutoSyncTaskState,
} from "./auto-sync.js";

export {
  ElevatedModeRequiredError,
  gateElevatedMode,
  formatElevatedModeRemaining,
  isElevatedModeActive,
  requireElevatedMode,
} from "./elevated-mode.js";

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
  createElevatedModeStore,
  type ElevatedModeState,
  type ElevatedModeStatus,
  type ElevatedModeStore,
} from "./stores/elevated-mode-store.js";

export type { ApprovalsState, ApprovalsStore } from "./stores/approvals-store.js";
export type { AgentStatusState, AgentStatusStore } from "./stores/agent-status-store.js";
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
export type { WorkboardState, WorkboardStore } from "./stores/workboard-store.js";
export type {
  ChatActiveSessionState,
  ChatAgent,
  ChatAgentsState,
  ChatSendState,
  ChatSessionsState,
  ChatState,
  ChatStore,
} from "./stores/chat-store.js";

export {
  WORK_ITEM_STATUSES,
  applyWorkTaskEvent,
  groupWorkItemsByStatus,
  selectTasksForSelectedWorkItem,
  shouldProcessWorkStateKvUpdate,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkItem,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
} from "./workboard/workboard-utils.js";
export type {
  WorkItemStatus,
  WorkItemsByStatus,
  WorkStateKvEntry,
  WorkTaskEvent,
  WorkTaskStatus,
  WorkTaskSummary,
  WorkTasksByWorkItemId,
} from "./workboard/workboard-utils.js";

// Re-exports for consumers (apps/desktop, packages/tui)
export type {
  ActionPrimitive,
  ClientCapability,
  EvaluationContext,
  AgentStateKVEntry,
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkItemStateKVEntry,
  WorkSignal,
  WorkStateKVScope,
} from "@tyrum/schemas";
export { checkPostcondition, deviceIdFromSha256Digest } from "@tyrum/schemas";

export {
  TyrumClient,
  autoExecute,
  normalizeFingerprint256,
  createTyrumHttpClient,
  createNodeFileDeviceIdentityStorage,
  loadOrCreateDeviceIdentity,
} from "@tyrum/client";
export type {
  CapabilityProvider,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  MemoryItem,
  TaskResult,
} from "@tyrum/client";
