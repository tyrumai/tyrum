import { z } from "zod";
import { AgentId, Lane, TyrumKey } from "../keys.js";
import {
  WsError,
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — session + commands
// ---------------------------------------------------------------------------

export const WsSessionSendPayload = z
  .object({
    agent_id: AgentId.optional(),
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    content: z.string().trim().min(1),
  })
  .strict();
export type WsSessionSendPayload = z.infer<typeof WsSessionSendPayload>;

export const WsSessionSendRequest = WsRequestEnvelope.extend({
  type: z.literal("session.send"),
  payload: WsSessionSendPayload,
});
export type WsSessionSendRequest = z.infer<typeof WsSessionSendRequest>;

export const WsSessionSendResult = z
  .object({
    session_id: z.string().trim().min(1),
    assistant_message: z.string(),
  })
  .strict();
export type WsSessionSendResult = z.infer<typeof WsSessionSendResult>;

export const WsCommandExecutePayload = z
  .object({
    command: z.string().trim().min(1),
    agent_id: AgentId.optional(),
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    key: TyrumKey.optional(),
    lane: Lane.optional(),
  })
  .strict();
export type WsCommandExecutePayload = z.infer<typeof WsCommandExecutePayload>;

export const WsCommandExecuteRequest = WsRequestEnvelope.extend({
  type: z.literal("command.execute"),
  payload: WsCommandExecutePayload,
});
export type WsCommandExecuteRequest = z.infer<typeof WsCommandExecuteRequest>;

export const WsCommandExecuteResult = z
  .object({
    output: z.string(),
    data: z.unknown().optional(),
  })
  .strict();
export type WsCommandExecuteResult = z.infer<typeof WsCommandExecuteResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — session.send
// ---------------------------------------------------------------------------

export const WsSessionSendResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.send"),
  result: WsSessionSendResult,
});
export type WsSessionSendResponseOkEnvelope = z.infer<typeof WsSessionSendResponseOkEnvelope>;

export const WsSessionSendResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.send"),
});
export type WsSessionSendResponseErrEnvelope = z.infer<typeof WsSessionSendResponseErrEnvelope>;

export const WsSessionSendResponseEnvelope = z.union([
  WsSessionSendResponseOkEnvelope,
  WsSessionSendResponseErrEnvelope,
]);
export type WsSessionSendResponseEnvelope = z.infer<typeof WsSessionSendResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — messaging/session
// ---------------------------------------------------------------------------

export const WsTypingEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: Lane.optional(),
  })
  .strict();
export type WsTypingEventPayload = z.infer<typeof WsTypingEventPayload>;

export const WsTypingStartedEvent = WsEventEnvelope.extend({
  type: z.literal("typing.started"),
  payload: WsTypingEventPayload,
});
export type WsTypingStartedEvent = z.infer<typeof WsTypingStartedEvent>;

export const WsTypingStoppedEvent = WsEventEnvelope.extend({
  type: z.literal("typing.stopped"),
  payload: WsTypingEventPayload,
});
export type WsTypingStoppedEvent = z.infer<typeof WsTypingStoppedEvent>;

export const WsMessageRole = z.enum(["assistant", "user", "system"]);
export type WsMessageRole = z.infer<typeof WsMessageRole>;

export const WsMessageDeltaEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: Lane.optional(),
    message_id: z.string().trim().min(1),
    role: WsMessageRole,
    delta: z.string(),
  })
  .strict();
export type WsMessageDeltaEventPayload = z.infer<typeof WsMessageDeltaEventPayload>;

export const WsMessageDeltaEvent = WsEventEnvelope.extend({
  type: z.literal("message.delta"),
  payload: WsMessageDeltaEventPayload,
});
export type WsMessageDeltaEvent = z.infer<typeof WsMessageDeltaEvent>;

export const WsMessageFinalEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: Lane.optional(),
    message_id: z.string().trim().min(1),
    role: WsMessageRole,
    content: z.string(),
  })
  .strict();
export type WsMessageFinalEventPayload = z.infer<typeof WsMessageFinalEventPayload>;

export const WsMessageFinalEvent = WsEventEnvelope.extend({
  type: z.literal("message.final"),
  payload: WsMessageFinalEventPayload,
});
export type WsMessageFinalEvent = z.infer<typeof WsMessageFinalEvent>;

export const WsFormattingFallbackEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    message_id: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();
export type WsFormattingFallbackEventPayload = z.infer<typeof WsFormattingFallbackEventPayload>;

export const WsFormattingFallbackEvent = WsEventEnvelope.extend({
  type: z.literal("formatting.fallback"),
  payload: WsFormattingFallbackEventPayload,
});
export type WsFormattingFallbackEvent = z.infer<typeof WsFormattingFallbackEvent>;

export const WsDeliveryReceiptStatus = z.enum(["sent", "failed"]);
export type WsDeliveryReceiptStatus = z.infer<typeof WsDeliveryReceiptStatus>;

export const WsDeliveryReceiptEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: Lane.optional(),
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    status: WsDeliveryReceiptStatus.optional(),
    receipt: z.unknown().optional(),
    error: WsError.optional(),
  })
  .strict();
export type WsDeliveryReceiptEventPayload = z.infer<typeof WsDeliveryReceiptEventPayload>;

export const WsDeliveryReceiptEvent = WsEventEnvelope.extend({
  type: z.literal("delivery.receipt"),
  payload: WsDeliveryReceiptEventPayload,
});
export type WsDeliveryReceiptEvent = z.infer<typeof WsDeliveryReceiptEvent>;
