import { z } from "zod";
import { DateTimeSchema } from "../common.js";
import { EventScope } from "../scope.js";

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
export const WsMessageEnvelope = z.union([WsRequestEnvelope, WsResponseEnvelope, WsEventEnvelope]);
export type WsMessageEnvelope = z.infer<typeof WsMessageEnvelope>;
