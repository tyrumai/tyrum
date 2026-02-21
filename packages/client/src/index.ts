// Client SDK entry point
export const VERSION = "0.1.0";

export { TyrumClient } from "./ws-client.js";
export type { TyrumClientOptions, TyrumClientEvents } from "./ws-client.js";

export { autoExecute } from "./capability.js";
export type { CapabilityProvider, TaskResult } from "./capability.js";

export type {
  ClientCapability,
  PeerRole,
  WsError,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsEventEnvelope,
  WsMessageEnvelope,
  WS_PROTOCOL_REV,
  CapabilityName,
  CapabilityDescriptor,
  WsConnectInitPayload,
  WsConnectInitRequest,
  WsConnectInitResult,
  WsConnectProofPayload,
  WsConnectProofRequest,
  WsConnectProofResult,
  WsTaskExecuteRequest,
  WsTaskExecutePayload,
  WsTaskExecuteResult,
  WsApprovalRequest,
  WsApprovalRequestPayload,
  WsApprovalDecision,
  WsSessionSendPayload,
  WsSessionSendRequest,
  WsSessionSendResult,
  WsWorkflowRunPayload,
  WsWorkflowRunRequest,
  WsWorkflowRunResult,
  WsPairingApprovePayload,
  WsPairingApproveRequest,
  WsPairingApproveResult,
  WsPairingDenyPayload,
  WsPairingDenyRequest,
  WsPairingDenyResult,
  WsPairingRevokePayload,
  WsPairingRevokeRequest,
  WsPairingRevokeResult,
  WsPairingApprovedEvent,
  WsPairingApprovedPayload,
  WsPlanUpdateEvent,
  WsPlanUpdatePayload,
  WsErrorEvent,
  WsErrorEventPayload,
  ActionPrimitive,
  ActionPrimitiveKind,
  PlanRequest,
  PlanResponse,
} from "./types.js";
