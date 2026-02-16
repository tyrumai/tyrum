/**
 * Convenience re-exports from @tyrum/schemas so consumers of @tyrum/client
 * don't need a direct dependency on the schemas package for common types.
 */

export type {
  ClientCapability,
  GatewayMessage,
  ClientMessage,
  TaskDispatchMessage,
  HumanConfirmationMessage,
  PlanUpdateMessage,
  ErrorMessage,
  ActionPrimitive,
  ActionPrimitiveKind,
  PlanRequest,
  PlanResponse,
} from "@tyrum/schemas";
