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
  type TyrumClientDynamicSchema,
  type TyrumClientEvents,
  type TyrumClientOptions as BaseTyrumClientOptions,
  type TyrumClientProtocolErrorInfo,
  type TyrumClientProtocolErrorKind,
} from "./ws-client.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";
import { VERSION } from "./version.js";

export { autoExecute } from "./capability.js";
export {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  DEFAULT_TYRUM_AI_SDK_CHAT_OPERATIONS,
  supportsTyrumAiSdkChatSocket,
  TyrumAiSdkChatTransport,
} from "./ai-sdk-chat.js";
export type { CapabilityProvider, TaskExecuteContext, TaskResult } from "./capability.js";
export type { ChatTransport, CreateUIMessage, UIMessage, UIMessageChunk } from "ai";
export type {
  AuditPlansListInput,
  AuditPlansListResult,
  StatusResponse,
  UsageResponse,
  PresenceResponse,
  NodeInventoryResponse,
  PairingListResponse,
  PairingGetResponse,
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
  ChannelConfigListResult,
  ChannelConfigCreateInput,
  ChannelConfigCreateResult,
  TelegramChannelConfigUpdateInput,
  ChannelConfigUpdateResult,
  ChannelConfigDeleteResult,
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
  DesktopEnvironmentHostListResult,
  DesktopEnvironmentListResult,
  DesktopEnvironmentGetResult,
  DesktopEnvironmentCreateInput,
  DesktopEnvironmentUpdateInput,
  DesktopEnvironmentMutateResult,
  DesktopEnvironmentDeleteResult,
  DesktopEnvironmentLogsResult,
  DeploymentPolicyConfigGetResult,
  DeploymentPolicyConfigListRevisionsResult,
  DeploymentPolicyConfigUpdateInput,
  DeploymentPolicyConfigUpdateResult,
  DeploymentPolicyConfigRevertInput,
  DeploymentPolicyConfigRevertResult,
  ToolRegistryListResult,
  SkillImportInput,
  UploadInput,
  McpImportInput,
  ExtensionsToggleInput,
  ExtensionsRevertInput,
  LocationPlace,
  LocationProfile,
  LocationPlaceListResult,
  LocationPlaceMutateResult,
  LocationPlaceDeleteResult,
  LocationProfileResult,
  LocationPlaceCreateInput,
  LocationPlaceUpdateInput,
  LocationProfileUpdateInput,
} from "./http/index.js";
export type {
  TyrumAiSdkChatOperations,
  TyrumAiSdkChatPreview,
  TyrumAiSdkChatReconnectPayload,
  TyrumAiSdkChatSession,
  TyrumAiSdkChatSessionClient,
  TyrumAiSdkChatSessionCreatePayload,
  TyrumAiSdkChatSessionDeletePayload,
  TyrumAiSdkChatSessionGetPayload,
  TyrumAiSdkChatSessionListPayload,
  TyrumAiSdkChatSessionSummary,
  TyrumAiSdkChatSendPayload,
  TyrumAiSdkChatSocket,
  TyrumAiSdkChatStreamEvent,
  TyrumAiSdkChatStreamStart,
  TyrumAiSdkChatTransportOptions,
  TyrumAiSdkChatTrigger,
} from "./ai-sdk-chat.js";
export type {
  Approval,
  ClientCapability,
  CheckpointSummary,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  NodePairingRequest,
  PendingApprovalState,
  PendingToolState,
  PresenceEntry,
  SessionContextState,
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
  WsLocationBeaconPayload,
  WsLocationBeaconResult,
  WsConnectRequest,
  WsConnectResult,
  WsTaskExecuteRequest,
  WsTaskExecutePayload,
  WsTaskExecuteResult,
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
  TyrumClientDynamicSchema,
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
