import { z } from "zod";
import {
  Approval,
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
} from "../approval.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — approvals
// ---------------------------------------------------------------------------

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

export const WsApprovalUpdatedEventPayload = z
  .object({
    approval: Approval,
  })
  .strict();
export type WsApprovalUpdatedEventPayload = z.infer<typeof WsApprovalUpdatedEventPayload>;

export const WsApprovalUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("approval.updated"),
  payload: WsApprovalUpdatedEventPayload,
});
export type WsApprovalUpdatedEvent = z.infer<typeof WsApprovalUpdatedEvent>;
