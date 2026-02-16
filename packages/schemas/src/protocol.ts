import { z } from "zod";
import { ActionPrimitive, ActionPrimitiveKind } from "./planner.js";

/** Client capability kinds. */
export const ClientCapability = z.enum(["playwright", "android", "cli", "http"]);
export type ClientCapability = z.infer<typeof ClientCapability>;

// --- Client → Gateway messages ---

export const HelloMessage = z.object({
  type: z.literal("hello"),
  capabilities: z.array(ClientCapability),
  client_id: z.string().optional(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

export const TaskResultMessage = z.object({
  type: z.literal("task_result"),
  task_id: z.string(),
  success: z.boolean(),
  evidence: z.unknown().optional(),
  error: z.string().optional(),
});
export type TaskResultMessage = z.infer<typeof TaskResultMessage>;

export const HumanResponseMessage = z.object({
  type: z.literal("human_response"),
  plan_id: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});
export type HumanResponseMessage = z.infer<typeof HumanResponseMessage>;

export const PongMessage = z.object({
  type: z.literal("pong"),
});

export const ClientMessage = z.discriminatedUnion("type", [
  HelloMessage,
  TaskResultMessage,
  HumanResponseMessage,
  PongMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- Gateway → Client messages ---

export const TaskDispatchMessage = z.object({
  type: z.literal("task_dispatch"),
  task_id: z.string(),
  plan_id: z.string(),
  action: ActionPrimitive,
});
export type TaskDispatchMessage = z.infer<typeof TaskDispatchMessage>;

export const HumanConfirmationMessage = z.object({
  type: z.literal("human_confirmation"),
  plan_id: z.string(),
  step_index: z.number().int().nonnegative(),
  prompt: z.string(),
  context: z.unknown().optional(),
});
export type HumanConfirmationMessage = z.infer<typeof HumanConfirmationMessage>;

export const PlanUpdateMessage = z.object({
  type: z.literal("plan_update"),
  plan_id: z.string(),
  status: z.string(),
  detail: z.string().optional(),
});
export type PlanUpdateMessage = z.infer<typeof PlanUpdateMessage>;

export const PingMessage = z.object({
  type: z.literal("ping"),
});

export const ErrorMessage = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof ErrorMessage>;

export const GatewayMessage = z.discriminatedUnion("type", [
  TaskDispatchMessage,
  HumanConfirmationMessage,
  PlanUpdateMessage,
  PingMessage,
  ErrorMessage,
]);
export type GatewayMessage = z.infer<typeof GatewayMessage>;

/** Maps ActionPrimitiveKind to the required client capability. */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, ClientCapability>> = {
  Web: "playwright",
  Android: "android",
  CLI: "cli",
  Http: "http",
};

export function requiredCapability(
  kind: ActionPrimitiveKind,
): ClientCapability | undefined {
  return CAPABILITY_MAP[kind];
}
