import {
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createBrowserLocalStorageDeviceIdentityStorage,
  createDeviceIdentity,
  DeviceIdentityError,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  signProofWithPrivateKey,
  type DeviceIdentity,
  type DeviceIdentityStorage,
} from "./device-identity.js";
import {
  createTyrumHttpClient as createBaseTyrumHttpClient,
  TyrumHttpClientError,
  type TyrumHttpAuthStrategy,
  type TyrumHttpClient,
  type TyrumHttpClientOperator,
  type TyrumHttpErrorCode,
  type TyrumHttpFetch,
  type TyrumRequestOptions,
} from "./http/index.js";
import type { TyrumHttpClientOptions as BaseTyrumHttpClientOptions } from "./http/shared.js";
import {
  TyrumClient as BaseTyrumClient,
  type TyrumClientEvents,
  type TyrumClientOptions as BaseTyrumClientOptions,
  type TyrumClientProtocolErrorInfo,
  type TyrumClientProtocolErrorKind,
} from "./ws-client.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";
import { VERSION } from "./version.js";

export { autoExecute } from "./capability.js";
export type { CapabilityProvider, TaskExecuteContext, TaskResult } from "./capability.js";
export type {
  AuditPlansListInput,
  AuditPlansListResult,
  StatusResponse,
  UsageResponse,
  PresenceResponse,
  NodeInventoryResponse,
  PairingListResponse,
  PairingMutateResponse,
  AuthTokenListEntry,
  AuthTokenListResult,
  AuthTokenIssueInput,
  AuthTokenIssueResult,
  AuthTokenRevokeInput,
  AuthTokenRevokeResult,
  AuthTokenUpdateInput,
  AuthTokenUpdateResult,
  AgentListResult,
  AgentStatusResult,
  RoutingConfigGetResult,
  RoutingConfigUpdateInput,
  RoutingConfigUpdateResult,
  RoutingConfigRevertInput,
  RoutingConfigRevertResult,
  AuditExportResult,
  AuditVerifyInput,
  AuditVerifyResult,
  AuditForgetInput,
  AuditForgetResult,
  ContextGetResponse,
  ContextListResponse,
  ContextDetailResponse,
  ArtifactMetadataResponse,
  ArtifactBytesResult,
  HealthResponse,
  ToolRegistryListResult,
  SkillImportInput,
  UploadInput,
  McpImportInput,
  ExtensionsToggleInput,
  ExtensionsRevertInput,
} from "./http/index.js";
export type {
  Approval,
  ClientCapability,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  SessionTranscriptApprovalItem,
  SessionTranscriptItem,
  SessionTranscriptTextItem,
  SessionTranscriptTextPreview,
  SessionTranscriptTextRole,
  SessionTranscriptToolItem,
  SessionTranscriptToolStatus,
  NodePairingRequest,
  PresenceEntry,
  WsError,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsEventEnvelope,
  WsMessageEnvelope,
  MemoryItemId,
  MemoryItemKind,
  MemorySensitivity,
  MemoryProvenanceSourceKind,
  MemoryProvenance,
  MemoryItem,
  MemoryItemPatch,
  MemorySearchHit,
  MemoryTombstone,
  MemoryItemFilter,
  MemoryForgetSelector,
  WsMemorySearchPayload,
  WsMemorySearchResult,
  WsMemoryListPayload,
  WsMemoryListResult,
  WsMemoryGetPayload,
  WsMemoryGetResult,
  WsMemoryUpdatePayload,
  WsMemoryUpdateResult,
  WsMemoryForgetPayload,
  WsMemoryForgetResult,
  WsMemoryExportPayload,
  WsMemoryExportResult,
  WsMemoryItemCreatedEvent,
  WsMemoryItemUpdatedEvent,
  WsMemoryItemDeletedEvent,
  WsMemoryItemForgottenEvent,
  WsMemoryItemConsolidatedEvent,
  WsMemoryExportCompletedEvent,
  WsSessionListItem,
  WsSessionListPayload,
  WsSessionListResult,
  WsSessionGetSession,
  WsSessionGetPayload,
  WsSessionGetResult,
  WsSessionCreatePayload,
  WsSessionCreateResult,
  WsSessionCompactPayload,
  WsSessionCompactResult,
  WsSessionDeletePayload,
  WsSessionDeleteResult,
  WsConnectRequest,
  WsConnectResult,
  WsTaskExecuteRequest,
  WsTaskExecutePayload,
  WsTaskExecuteResult,
  WsApprovalRequest,
  WsApprovalRequestPayload,
  WsApprovalDecision,
  WsPlanUpdateEvent,
  WsPlanUpdatePayload,
  WsErrorEvent,
  WsErrorEventPayload,
  ActionPrimitive,
  ActionPrimitiveKind,
  PlanRequest,
  PlanResponse,
} from "./types.js";

export type BrowserTyrumHttpClientOptions = Omit<
  BaseTyrumHttpClientOptions,
  "tlsCertFingerprint256" | "tlsAllowSelfSigned" | "tlsCaCertPem"
>;

export type BrowserTyrumClientOptions = Omit<
  BaseTyrumClientOptions,
  "tlsCertFingerprint256" | "tlsAllowSelfSigned" | "tlsCaCertPem"
>;

export class TyrumClient extends BaseTyrumClient {
  constructor(options: BrowserTyrumClientOptions) {
    super(options as BaseTyrumClientOptions);
  }
}

export function createTyrumHttpClient(
  options: BrowserTyrumHttpClientOptions,
): TyrumHttpClientOperator {
  return createBaseTyrumHttpClient(options);
}

export {
  normalizeFingerprint256,
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createBrowserLocalStorageDeviceIdentityStorage,
  createDeviceIdentity,
  DeviceIdentityError,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  signProofWithPrivateKey,
  TyrumHttpClientError,
};
export type {
  DeviceIdentity,
  DeviceIdentityStorage,
  TyrumClientEvents,
  TyrumClientProtocolErrorInfo,
  TyrumClientProtocolErrorKind,
  TyrumHttpAuthStrategy,
  TyrumHttpClient,
  TyrumHttpClientOperator,
  TyrumHttpErrorCode,
  TyrumHttpFetch,
  TyrumRequestOptions,
};
export { VERSION };
