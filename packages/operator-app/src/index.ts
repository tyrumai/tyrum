export {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  httpAuthForAuth,
  selectAuthForElevatedMode,
  wsTokenForAuth,
} from "./auth.js";
export type { OperatorAuthStrategy } from "./auth.js";
export {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
} from "@tyrum/transport-sdk";

export { createGatewayAuthSession, clearGatewayAuthSession } from "./auth-session.js";
export {
  approvalUpdatedAt,
  isApprovalBlockedStatus,
  isApprovalHumanActionableStatus,
  isApprovalTerminalStatus,
  isPairingBlockedStatus,
  isPairingHumanActionableStatus,
  pairingUpdatedAt,
} from "./review-status.js";
export type { ApprovalStatus, PairingStatus } from "./review-status.js";

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
export type {
  OperatorAdminClient,
  OperatorChatSocket,
  OperatorWorkboardClient,
} from "./operator-core.types.js";
export type {
  TyrumAiSdkChatSession,
  TyrumAiSdkChatSessionClient,
  TyrumAiSdkChatSessionSummary,
  TyrumAiSdkChatSocket,
} from "@tyrum/transport-sdk";

export type { ExternalStore, Unsubscribe } from "./store.js";
export { createStore } from "./store.js";

export type { OperatorCoreError, OperatorCoreErrorKind } from "./operator-error.js";
export { AgentConfig, IdentityPack } from "@tyrum/contracts";

export {
  createElevatedModeStore,
  type ElevatedModeState,
  type ElevatedModeStatus,
  type ElevatedModeStore,
} from "./stores/elevated-mode-store.js";

export type {
  ApprovalsState,
  ApprovalsStore,
  ResolveApprovalInput,
  ResolveApprovalOverride,
  ResolveApprovalResult,
} from "./stores/approvals-store.js";
export type {
  ActivityAgent,
  ActivityAttentionLevel,
  ActivityEvent,
  ActivityLeaseState,
  ActivityRoom,
  ActivityState,
  ActivityStore,
  ActivityWorkstream,
} from "./stores/activity-store.js";
export type { AgentStatusState, AgentStatusStore } from "./stores/agent-status-store.js";
export type { ConnectionState, ConnectionStore } from "./stores/connection-store.js";
export type {
  DesktopEnvironmentHostsState,
  DesktopEnvironmentHostsStore,
} from "./stores/desktop-environment-hosts-store.js";
export type {
  DesktopEnvironmentLogState,
  DesktopEnvironmentsState,
  DesktopEnvironmentsStore,
} from "./stores/desktop-environments-store.js";
export type { Pairing, PairingState, PairingStore } from "./stores/pairing-store.js";
export type { RunsState, RunsStore } from "./stores/runs-store.js";
export type { OperatorPresenceEntry, StatusState, StatusStore } from "./stores/status-store.js";
export type {
  TranscriptDetailState,
  TranscriptState,
  TranscriptStore,
} from "./stores/transcript-store.js";
export type {
  WorkboardScopeKeys,
  WorkboardState,
  WorkboardStore,
} from "./stores/workboard-store.js";
export { toWorkboardScopePayload } from "./stores/workboard-store.js";
export type {
  ChatActiveSessionState,
  ChatAgent,
  ChatAgentsState,
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

export type {
  Approval,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
} from "@tyrum/contracts";
