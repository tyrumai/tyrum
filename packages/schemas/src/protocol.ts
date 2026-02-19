import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { ActionPrimitive, ActionPrimitiveKind } from "./planner.js";
import { EventScope } from "./scope.js";
import {
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
} from "./approval.js";

/** Client capability kinds. */
export const ClientCapability = z.enum(["playwright", "android", "desktop", "cli", "http"]);
export type ClientCapability = z.infer<typeof ClientCapability>;

// ---------------------------------------------------------------------------
// WebSocket protocol (v1) — request/response envelopes + events
// ---------------------------------------------------------------------------

/**
 * Standard structured error for WS responses and error events.
 */
export const WsError = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();
export type WsError = z.infer<typeof WsError>;

/**
 * Request envelope (direction-agnostic).
 *
 * A request always has:
 * - `request_id` for correlation (and retries/idempotency at higher layers)
 * - `type` identifying the operation
 * - `payload` with typed inputs for that operation
 */
export const WsRequestEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown(),
    trace: z.unknown().optional(),
  })
  .strict();
export type WsRequestEnvelope = z.infer<typeof WsRequestEnvelope>;

export const WsResponseOkEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown().optional(),
  })
  .strict();
export type WsResponseOkEnvelope = z.infer<typeof WsResponseOkEnvelope>;

export const WsResponseErrEnvelope = z
  .object({
    request_id: z.string().min(1),
    type: z.string().min(1),
    ok: z.literal(false),
    error: WsError,
  })
  .strict();
export type WsResponseErrEnvelope = z.infer<typeof WsResponseErrEnvelope>;

/** Response envelope (direction-agnostic). */
export const WsResponseEnvelope = z.union([WsResponseOkEnvelope, WsResponseErrEnvelope]);
export type WsResponseEnvelope = z.infer<typeof WsResponseEnvelope>;

/** Event envelope (gateway-emitted server push). */
export const WsEventEnvelope = z
  .object({
    event_id: z.string().min(1),
    type: z.string().min(1),
    occurred_at: DateTimeSchema,
    scope: EventScope.optional(),
    payload: z.unknown(),
  })
  .strict();
export type WsEventEnvelope = z.infer<typeof WsEventEnvelope>;

/** Any WS message. */
export const WsMessageEnvelope = z.union([
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsEventEnvelope,
]);
export type WsMessageEnvelope = z.infer<typeof WsMessageEnvelope>;

// ---------------------------------------------------------------------------
// Operation payloads (typed)
// ---------------------------------------------------------------------------

export const WsConnectPayload = z
  .object({
    capabilities: z.array(ClientCapability).default([]),
    client_id: z.string().min(1).optional(),
  })
  .strict();
export type WsConnectPayload = z.infer<typeof WsConnectPayload>;

export const WsConnectRequest = WsRequestEnvelope.extend({
  type: z.literal("connect"),
  payload: WsConnectPayload,
});
export type WsConnectRequest = z.infer<typeof WsConnectRequest>;

export const WsConnectResult = z
  .object({
    client_id: z.string().min(1),
  })
  .strict();
export type WsConnectResult = z.infer<typeof WsConnectResult>;

export const WsPingPayload = z.object({}).strict();
export type WsPingPayload = z.infer<typeof WsPingPayload>;

export const WsPingRequest = WsRequestEnvelope.extend({
  type: z.literal("ping"),
  payload: WsPingPayload,
});
export type WsPingRequest = z.infer<typeof WsPingRequest>;

export const WsTaskExecutePayload = z
  .object({
    plan_id: z.string().min(1),
    step_index: z.number().int().nonnegative(),
    action: ActionPrimitive,
  })
  .strict();
export type WsTaskExecutePayload = z.infer<typeof WsTaskExecutePayload>;

export const WsTaskExecuteRequest = WsRequestEnvelope.extend({
  type: z.literal("task.execute"),
  payload: WsTaskExecutePayload,
});
export type WsTaskExecuteRequest = z.infer<typeof WsTaskExecuteRequest>;

export const WsTaskExecuteResult = z
  .object({
    result: z.unknown().optional(),
    evidence: z.unknown().optional(),
  })
  .strict();
export type WsTaskExecuteResult = z.infer<typeof WsTaskExecuteResult>;

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
// Operation responses (typed)
// ---------------------------------------------------------------------------

export const WsConnectResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("connect"),
  result: WsConnectResult,
});
export type WsConnectResponseOkEnvelope = z.infer<typeof WsConnectResponseOkEnvelope>;

export const WsConnectResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("connect"),
});
export type WsConnectResponseErrEnvelope = z.infer<typeof WsConnectResponseErrEnvelope>;

export const WsConnectResponseEnvelope = z.union([
  WsConnectResponseOkEnvelope,
  WsConnectResponseErrEnvelope,
]);
export type WsConnectResponseEnvelope = z.infer<typeof WsConnectResponseEnvelope>;

export const WsPingResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseOkEnvelope = z.infer<typeof WsPingResponseOkEnvelope>;

export const WsPingResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("ping"),
});
export type WsPingResponseErrEnvelope = z.infer<typeof WsPingResponseErrEnvelope>;

export const WsPingResponseEnvelope = z.union([
  WsPingResponseOkEnvelope,
  WsPingResponseErrEnvelope,
]);
export type WsPingResponseEnvelope = z.infer<typeof WsPingResponseEnvelope>;

export const WsTaskExecuteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("task.execute"),
  result: WsTaskExecuteResult,
});
export type WsTaskExecuteResponseOkEnvelope = z.infer<
  typeof WsTaskExecuteResponseOkEnvelope
>;

export const WsTaskExecuteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("task.execute"),
});
export type WsTaskExecuteResponseErrEnvelope = z.infer<
  typeof WsTaskExecuteResponseErrEnvelope
>;

export const WsTaskExecuteResponseEnvelope = z.union([
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
]);
export type WsTaskExecuteResponseEnvelope = z.infer<
  typeof WsTaskExecuteResponseEnvelope
>;

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
export type WsApprovalRequestResponseEnvelope = z.infer<
  typeof WsApprovalRequestResponseEnvelope
>;

export const WsApprovalListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("approval.list"),
  result: WsApprovalListResult,
});
export type WsApprovalListResponseOkEnvelope = z.infer<
  typeof WsApprovalListResponseOkEnvelope
>;

export const WsApprovalListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("approval.list"),
});
export type WsApprovalListResponseErrEnvelope = z.infer<
  typeof WsApprovalListResponseErrEnvelope
>;

export const WsApprovalListResponseEnvelope = z.union([
  WsApprovalListResponseOkEnvelope,
  WsApprovalListResponseErrEnvelope,
]);
export type WsApprovalListResponseEnvelope = z.infer<
  typeof WsApprovalListResponseEnvelope
>;

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
export type WsApprovalResolveResponseEnvelope = z.infer<
  typeof WsApprovalResolveResponseEnvelope
>;

export const WsResponse = z.union([
  WsConnectResponseOkEnvelope,
  WsConnectResponseErrEnvelope,
  WsPingResponseOkEnvelope,
  WsPingResponseErrEnvelope,
  WsTaskExecuteResponseOkEnvelope,
  WsTaskExecuteResponseErrEnvelope,
  WsApprovalRequestResponseOkEnvelope,
  WsApprovalRequestResponseErrEnvelope,
  WsApprovalListResponseOkEnvelope,
  WsApprovalListResponseErrEnvelope,
  WsApprovalResolveResponseOkEnvelope,
  WsApprovalResolveResponseErrEnvelope,
]);
export type WsResponse = z.infer<typeof WsResponse>;

export const WsPlanUpdatePayload = z
  .object({
    plan_id: z.string().min(1),
    status: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();
export type WsPlanUpdatePayload = z.infer<typeof WsPlanUpdatePayload>;

export const WsPlanUpdateEvent = WsEventEnvelope.extend({
  type: z.literal("plan.update"),
  payload: WsPlanUpdatePayload,
});
export type WsPlanUpdateEvent = z.infer<typeof WsPlanUpdateEvent>;

export const WsErrorEventPayload = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type WsErrorEventPayload = z.infer<typeof WsErrorEventPayload>;

export const WsErrorEvent = WsEventEnvelope.extend({
  type: z.literal("error"),
  payload: WsErrorEventPayload,
});
export type WsErrorEvent = z.infer<typeof WsErrorEvent>;

export const WsRequest = z.discriminatedUnion("type", [
  WsConnectRequest,
  WsPingRequest,
  WsTaskExecuteRequest,
  WsApprovalRequest,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
]);
export type WsRequest = z.infer<typeof WsRequest>;

export const WsEvent = z.discriminatedUnion("type", [
  WsPlanUpdateEvent,
  WsErrorEvent,
]);
export type WsEvent = z.infer<typeof WsEvent>;

export const WsMessage = z.union([WsRequest, WsResponse, WsEvent]);
export type WsMessage = z.infer<typeof WsMessage>;

/** Maps ActionPrimitiveKind to the required client capability. */
const CAPABILITY_MAP: Partial<Record<ActionPrimitiveKind, ClientCapability>> = {
  Web: "playwright",
  Android: "android",
  Desktop: "desktop",
  CLI: "cli",
  Http: "http",
};

export function requiredCapability(
  kind: ActionPrimitiveKind,
): ClientCapability | undefined {
  return CAPABILITY_MAP[kind];
}
