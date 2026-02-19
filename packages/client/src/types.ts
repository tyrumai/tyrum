/**
 * Convenience re-exports from @tyrum/schemas so consumers of @tyrum/client
 * don't need a direct dependency on the schemas package for common types.
 */

export type {
  ClientCapability,
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
} from "@tyrum/schemas";
