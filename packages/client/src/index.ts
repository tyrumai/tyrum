// Client SDK entry point
export const VERSION = "0.1.0";

export { TyrumClient } from "./ws-client.js";
export type { TyrumClientOptions, TyrumClientEvents } from "./ws-client.js";

export { autoExecute } from "./capability.js";
export type { CapabilityProvider, TaskExecuteContext, TaskResult } from "./capability.js";

export {
  createTyrumHttpClient,
  TyrumHttpClientError,
  type TyrumHttpAuthStrategy,
  type TyrumHttpClient,
  type TyrumHttpClientOperator,
  type TyrumHttpClientOptions,
  type TyrumHttpErrorCode,
  type TyrumHttpFetch,
  type TyrumRequestOptions,
} from "./http/index.js";

export type {
  StatusResponse,
  UsageResponse,
  PresenceResponse,
  PairingListResponse,
  PairingMutateResponse,
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
} from "./http/index.js";

export {
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createBrowserLocalStorageDeviceIdentityStorage,
  createDeviceIdentity,
  createNodeFileDeviceIdentityStorage,
  DeviceIdentityError,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  signProofWithPrivateKey,
} from "./device-identity.js";
export type { DeviceIdentity, DeviceIdentityStorage } from "./device-identity.js";

export type {
  Approval,
  ClientCapability,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  NodePairingRequest,
  PresenceEntry,
  WsError,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsEventEnvelope,
  WsMessageEnvelope,
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
