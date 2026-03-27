import { z } from "zod";
import { ExecutionBudgets, TurnId } from "../execution.js";
import { AgentConversationKey } from "../keys.js";
import { ActionPrimitive } from "../planner.js";
import { WsRequestEnvelope, WsResponseErrEnvelope, WsResponseOkEnvelope } from "./envelopes.js";

export const WsWorkflowStartPayload = z
  .object({
    conversation_key: AgentConversationKey,
    plan_id: z.string().trim().min(1).optional(),
    request_id: z.string().trim().min(1).optional(),
    steps: z.array(ActionPrimitive).min(1),
    budgets: ExecutionBudgets.optional(),
  })
  .strict();
export type WsWorkflowStartPayload = z.infer<typeof WsWorkflowStartPayload>;

export const WsWorkflowStartRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.start"),
  payload: WsWorkflowStartPayload,
});
export type WsWorkflowStartRequest = z.infer<typeof WsWorkflowStartRequest>;

export const WsWorkflowStartResult = z
  .object({
    job_id: z.string().trim().min(1),
    turn_id: z.string().trim().min(1),
    plan_id: z.string().trim().min(1),
    request_id: z.string().trim().min(1),
    conversation_key: AgentConversationKey,
    steps_count: z.number().int().nonnegative(),
  })
  .strict();
export type WsWorkflowStartResult = z.infer<typeof WsWorkflowStartResult>;

export const WsWorkflowResumePayload = z
  .object({
    token: z.string().trim().min(1),
  })
  .strict();
export type WsWorkflowResumePayload = z.infer<typeof WsWorkflowResumePayload>;

export const WsWorkflowResumeRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.resume"),
  payload: WsWorkflowResumePayload,
});
export type WsWorkflowResumeRequest = z.infer<typeof WsWorkflowResumeRequest>;

export const WsWorkflowResumeResult = z
  .object({
    turn_id: TurnId,
  })
  .strict();
export type WsWorkflowResumeResult = z.infer<typeof WsWorkflowResumeResult>;

export const WsWorkflowCancelPayload = z
  .object({
    turn_id: TurnId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsWorkflowCancelPayload = z.infer<typeof WsWorkflowCancelPayload>;

export const WsWorkflowCancelRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.cancel"),
  payload: WsWorkflowCancelPayload,
});
export type WsWorkflowCancelRequest = z.infer<typeof WsWorkflowCancelRequest>;

export const WsWorkflowCancelResult = z
  .object({
    turn_id: TurnId,
    cancelled: z.boolean(),
  })
  .strict();
export type WsWorkflowCancelResult = z.infer<typeof WsWorkflowCancelResult>;

export const WsWorkflowStartResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.start"),
  result: WsWorkflowStartResult,
});
export type WsWorkflowStartResponseOkEnvelope = z.infer<typeof WsWorkflowStartResponseOkEnvelope>;

export const WsWorkflowStartResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.start"),
});
export type WsWorkflowStartResponseErrEnvelope = z.infer<typeof WsWorkflowStartResponseErrEnvelope>;

export const WsWorkflowStartResponseEnvelope = z.union([
  WsWorkflowStartResponseOkEnvelope,
  WsWorkflowStartResponseErrEnvelope,
]);
export type WsWorkflowStartResponseEnvelope = z.infer<typeof WsWorkflowStartResponseEnvelope>;

export const WsWorkflowResumeResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.resume"),
  result: WsWorkflowResumeResult,
});
export type WsWorkflowResumeResponseOkEnvelope = z.infer<typeof WsWorkflowResumeResponseOkEnvelope>;

export const WsWorkflowResumeResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.resume"),
});
export type WsWorkflowResumeResponseErrEnvelope = z.infer<
  typeof WsWorkflowResumeResponseErrEnvelope
>;

export const WsWorkflowResumeResponseEnvelope = z.union([
  WsWorkflowResumeResponseOkEnvelope,
  WsWorkflowResumeResponseErrEnvelope,
]);
export type WsWorkflowResumeResponseEnvelope = z.infer<typeof WsWorkflowResumeResponseEnvelope>;

export const WsWorkflowCancelResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.cancel"),
  result: WsWorkflowCancelResult,
});
export type WsWorkflowCancelResponseOkEnvelope = z.infer<typeof WsWorkflowCancelResponseOkEnvelope>;

export const WsWorkflowCancelResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.cancel"),
});
export type WsWorkflowCancelResponseErrEnvelope = z.infer<
  typeof WsWorkflowCancelResponseErrEnvelope
>;

export const WsWorkflowCancelResponseEnvelope = z.union([
  WsWorkflowCancelResponseOkEnvelope,
  WsWorkflowCancelResponseErrEnvelope,
]);
export type WsWorkflowCancelResponseEnvelope = z.infer<typeof WsWorkflowCancelResponseEnvelope>;
