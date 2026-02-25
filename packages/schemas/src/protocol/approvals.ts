import { z } from "zod";
import {
  Approval,
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
} from "../approval.js";
import { DateTimeSchema } from "../common.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — approvals
// ---------------------------------------------------------------------------

export const WsApprovalRequestPayload = z
  .object({
    approval_id: z.number().int().positive(),
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    prompt: z.string().min(1),
    context: z.unknown().optional(),
    expires_at: DateTimeSchema.nullable().optional(),
  })
  .strict();
export type WsApprovalRequestPayload = z.infer<typeof WsApprovalRequestPayload>;

export const WsApprovalRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.request"),
  payload: WsApprovalRequestPayload,
});
export type WsApprovalRequest = z.infer<typeof WsApprovalRequest>;

export const WsApprovalDecision = z
  .object({
    approved: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();
export type WsApprovalDecision = z.infer<typeof WsApprovalDecision>;

export const WsApprovalListPayload = ApprovalListRequest;
export type WsApprovalListPayload = z.infer<typeof WsApprovalListPayload>;

export const WsApprovalListRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.list"),
  payload: WsApprovalListPayload,
});
export type WsApprovalListRequest = z.infer<typeof WsApprovalListRequest>;

export const WsApprovalListResult = ApprovalListResponse;
export type WsApprovalListResult = z.infer<typeof WsApprovalListResult>;

export const WsApprovalResolvePayload = ApprovalResolveRequest;
export type WsApprovalResolvePayload = z.infer<typeof WsApprovalResolvePayload>;

export const WsApprovalResolveRequest = WsRequestEnvelope.extend({
  type: z.literal("approval.resolve"),
  payload: WsApprovalResolvePayload,
});
export type WsApprovalResolveRequest = z.infer<typeof WsApprovalResolveRequest>;

export const WsApprovalResolveResult = ApprovalResolveResponse;
export type WsApprovalResolveResult = z.infer<typeof WsApprovalResolveResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — approvals
// ---------------------------------------------------------------------------

export const WsApprovalRequestResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.request"),
  result: WsApprovalDecision,
});
export type WsApprovalRequestResponseOkEnvelope = z.infer<
  typeof WsApprovalRequestResponseOkEnvelope
>;

export const WsApprovalRequestResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.request"),
});
export type WsApprovalRequestResponseErrEnvelope = z.infer<
  typeof WsApprovalRequestResponseErrEnvelope
>;

export const WsApprovalRequestResponseEnvelope = z.union([
  WsApprovalRequestResponseOkEnvelope,
  WsApprovalRequestResponseErrEnvelope,
]);
export type WsApprovalRequestResponseEnvelope = z.infer<typeof WsApprovalRequestResponseEnvelope>;

export const WsApprovalListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.list"),
  result: WsApprovalListResult,
});
export type WsApprovalListResponseOkEnvelope = z.infer<typeof WsApprovalListResponseOkEnvelope>;

export const WsApprovalListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.list"),
});
export type WsApprovalListResponseErrEnvelope = z.infer<typeof WsApprovalListResponseErrEnvelope>;

export const WsApprovalListResponseEnvelope = z.union([
  WsApprovalListResponseOkEnvelope,
  WsApprovalListResponseErrEnvelope,
]);
export type WsApprovalListResponseEnvelope = z.infer<typeof WsApprovalListResponseEnvelope>;

export const WsApprovalResolveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.resolve"),
  result: WsApprovalResolveResult,
});
export type WsApprovalResolveResponseOkEnvelope = z.infer<
  typeof WsApprovalResolveResponseOkEnvelope
>;

export const WsApprovalResolveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.resolve"),
});
export type WsApprovalResolveResponseErrEnvelope = z.infer<
  typeof WsApprovalResolveResponseErrEnvelope
>;

export const WsApprovalResolveResponseEnvelope = z.union([
  WsApprovalResolveResponseOkEnvelope,
  WsApprovalResolveResponseErrEnvelope,
]);
export type WsApprovalResolveResponseEnvelope = z.infer<typeof WsApprovalResolveResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — approvals
// ---------------------------------------------------------------------------

export const WsApprovalRequestedEventPayload = z
  .object({
    approval: Approval,
  })
  .strict();
export type WsApprovalRequestedEventPayload = z.infer<typeof WsApprovalRequestedEventPayload>;

export const WsApprovalRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.requested"),
  payload: WsApprovalRequestedEventPayload,
});
export type WsApprovalRequestedEvent = z.infer<typeof WsApprovalRequestedEvent>;

export const WsApprovalResolvedEventPayload = z
  .object({
    approval: Approval,
  })
  .strict();
export type WsApprovalResolvedEventPayload = z.infer<typeof WsApprovalResolvedEventPayload>;

export const WsApprovalResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.resolved"),
  payload: WsApprovalResolvedEventPayload,
});
export type WsApprovalResolvedEvent = z.infer<typeof WsApprovalResolvedEvent>;
