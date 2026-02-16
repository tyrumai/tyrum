// Client SDK entry point
export const VERSION = "0.1.0";

export { TyrumClient } from "./ws-client.js";
export type { TyrumClientOptions, TyrumClientEvents } from "./ws-client.js";

export { autoExecute } from "./capability.js";
export type { CapabilityProvider, TaskResult } from "./capability.js";

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
} from "./types.js";
