import { z } from "zod";
import { ExecutionBudgets } from "../execution.js";
import { Lane, TyrumKey } from "../keys.js";
import { ActionPrimitive } from "../planner.js";
import { WsRequestEnvelope, WsResponseErrEnvelope, WsResponseOkEnvelope } from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — workflow
// ---------------------------------------------------------------------------

export const WsWorkflowRunPayload = z
  .object({
    key: TyrumKey,
    lane: Lane.default("main"),
    plan_id: z.string().trim().min(1).optional(),
    request_id: z.string().trim().min(1).optional(),
    steps: z.array(ActionPrimitive).min(1),
    budgets: ExecutionBudgets.optional(),
  })
  .strict();
export type WsWorkflowRunPayload = z.infer<typeof WsWorkflowRunPayload>;

export const WsWorkflowRunRequest = WsRequestEnvelope.extend({
  type: z.literal("workflow.run"),
  payload: WsWorkflowRunPayload,
});
export type WsWorkflowRunRequest = z.infer<typeof WsWorkflowRunRequest>;

export const WsWorkflowRunResult = z
  .object({
    job_id: z.string().trim().min(1),
    run_id: z.string().trim().min(1),
    plan_id: z.string().trim().min(1),
    request_id: z.string().trim().min(1),
    key: TyrumKey,
    lane: Lane,
    steps_count: z.number().int().nonnegative(),
  })
  .strict();
export type WsWorkflowRunResult = z.infer<typeof WsWorkflowRunResult>;

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
    run_id: z.string().trim().min(1),
  })
  .strict();
export type WsWorkflowResumeResult = z.infer<typeof WsWorkflowResumeResult>;

export const WsWorkflowCancelPayload = z
  .object({
    run_id: z.string().trim().min(1),
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
    run_id: z.string().trim().min(1),
    cancelled: z.boolean(),
  })
  .strict();
export type WsWorkflowCancelResult = z.infer<typeof WsWorkflowCancelResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — workflow
// ---------------------------------------------------------------------------

export const WsWorkflowRunResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("workflow.run"),
  result: WsWorkflowRunResult,
});
export type WsWorkflowRunResponseOkEnvelope = z.infer<typeof WsWorkflowRunResponseOkEnvelope>;

export const WsWorkflowRunResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("workflow.run"),
});
export type WsWorkflowRunResponseErrEnvelope = z.infer<typeof WsWorkflowRunResponseErrEnvelope>;

export const WsWorkflowRunResponseEnvelope = z.union([
  WsWorkflowRunResponseOkEnvelope,
  WsWorkflowRunResponseErrEnvelope,
]);
export type WsWorkflowRunResponseEnvelope = z.infer<typeof WsWorkflowRunResponseEnvelope>;

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
