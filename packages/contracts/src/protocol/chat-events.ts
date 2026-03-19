import { z } from "zod";
import { Lane } from "../keys.js";
import { WsError, WsEventEnvelope } from "./envelopes.js";

export const WsMessageRole = z.enum(["assistant", "user", "system"]);
export type WsMessageRole = z.infer<typeof WsMessageRole>;

const WsChatEventLane = z.union([Lane, z.enum(["user", "assistant"])]);

export const WsTypingEventPayload = z
  .object({
    session_id: z.string().trim().min(1).optional(),
    lane: WsChatEventLane.optional(),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((payload) => payload.session_id !== undefined || payload.thread_id !== undefined, {
    message: "session_id or thread_id required",
  });
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

export const WsMessageDeltaEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: WsChatEventLane.optional(),
    message_id: z.string().trim().min(1),
    role: WsMessageRole,
    delta: z.string(),
    thread_id: z.string().trim().min(1).optional(),
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
    lane: WsChatEventLane.optional(),
    message_id: z.string().trim().min(1),
    role: WsMessageRole,
    content: z.string(),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsMessageFinalEventPayload = z.infer<typeof WsMessageFinalEventPayload>;

export const WsMessageFinalEvent = WsEventEnvelope.extend({
  type: z.literal("message.final"),
  payload: WsMessageFinalEventPayload,
});
export type WsMessageFinalEvent = z.infer<typeof WsMessageFinalEvent>;

export const WsReasoningDeltaEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: WsChatEventLane.optional(),
    reasoning_id: z.string().trim().min(1),
    delta: z.string(),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsReasoningDeltaEventPayload = z.infer<typeof WsReasoningDeltaEventPayload>;

export const WsReasoningDeltaEvent = WsEventEnvelope.extend({
  type: z.literal("reasoning.delta"),
  payload: WsReasoningDeltaEventPayload,
});
export type WsReasoningDeltaEvent = z.infer<typeof WsReasoningDeltaEvent>;

export const WsReasoningFinalEventPayload = z
  .object({
    session_id: z.string().trim().min(1),
    lane: WsChatEventLane.optional(),
    reasoning_id: z.string().trim().min(1),
    content: z.string(),
    thread_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsReasoningFinalEventPayload = z.infer<typeof WsReasoningFinalEventPayload>;

export const WsReasoningFinalEvent = WsEventEnvelope.extend({
  type: z.literal("reasoning.final"),
  payload: WsReasoningFinalEventPayload,
});
export type WsReasoningFinalEvent = z.infer<typeof WsReasoningFinalEvent>;

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
