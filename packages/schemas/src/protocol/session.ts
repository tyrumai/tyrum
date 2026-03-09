import { z } from "zod";
import { DateTimeSchema } from "../common.js";
import { AgentKey, Lane, TyrumKey } from "../keys.js";
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

export const WsMessageRole = z.enum(["assistant", "user", "system"]);
export type WsMessageRole = z.infer<typeof WsMessageRole>;

export const WsSessionSendPayload = z
  .object({
    agent_id: AgentKey.optional(),
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    content: z.string().trim().min(1),
    attached_node_id: z.string().trim().min(1).optional(),
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

export const WsSessionTurn = z
  .object({
    role: WsMessageRole,
    content: z.string(),
  })
  .strict();
export type WsSessionTurn = z.infer<typeof WsSessionTurn>;

export const WsSessionListPayload = z
  .object({
    agent_id: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsSessionListPayload = z.infer<typeof WsSessionListPayload>;

export const WsSessionListRequest = WsRequestEnvelope.extend({
  type: z.literal("session.list"),
  payload: WsSessionListPayload,
});
export type WsSessionListRequest = z.infer<typeof WsSessionListRequest>;

export const WsSessionGetPayload = z
  .object({
    agent_id: AgentKey.optional(),
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsSessionGetPayload = z.infer<typeof WsSessionGetPayload>;

export const WsSessionGetRequest = WsRequestEnvelope.extend({
  type: z.literal("session.get"),
  payload: WsSessionGetPayload,
});
export type WsSessionGetRequest = z.infer<typeof WsSessionGetRequest>;

export const WsSessionCreatePayload = z
  .object({
    agent_id: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsSessionCreatePayload = z.infer<typeof WsSessionCreatePayload>;

export const WsSessionCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("session.create"),
  payload: WsSessionCreatePayload,
});
export type WsSessionCreateRequest = z.infer<typeof WsSessionCreateRequest>;

export const WsSessionCompactPayload = z
  .object({
    agent_id: AgentKey.optional(),
    session_id: z.string().trim().min(1),
    keep_last_messages: z.number().int().positive().max(200).optional(),
  })
  .strict();
export type WsSessionCompactPayload = z.infer<typeof WsSessionCompactPayload>;

export const WsSessionCompactRequest = WsRequestEnvelope.extend({
  type: z.literal("session.compact"),
  payload: WsSessionCompactPayload,
});
export type WsSessionCompactRequest = z.infer<typeof WsSessionCompactRequest>;

export const WsSessionDeletePayload = z
  .object({
    agent_id: AgentKey.optional(),
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsSessionDeletePayload = z.infer<typeof WsSessionDeletePayload>;

export const WsSessionDeleteRequest = WsRequestEnvelope.extend({
  type: z.literal("session.delete"),
  payload: WsSessionDeletePayload,
});
export type WsSessionDeleteRequest = z.infer<typeof WsSessionDeleteRequest>;

export const WsCommandExecutePayload = z
  .object({
    command: z.string().trim().min(1),
    agent_id: AgentKey.optional(),
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

export const WsSessionListItem = z
  .object({
    session_id: z.string().trim().min(1),
    agent_id: AgentKey,
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    title: z.string().default(""),
    summary: z.string().default(""),
    turns_count: z.number().int().nonnegative(),
    updated_at: DateTimeSchema,
    created_at: DateTimeSchema,
    last_turn: WsSessionTurn.optional(),
  })
  .strict();
export type WsSessionListItem = z.infer<typeof WsSessionListItem>;

export const WsSessionListResult = z
  .object({
    sessions: z.array(WsSessionListItem),
    next_cursor: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type WsSessionListResult = z.infer<typeof WsSessionListResult>;

export const WsSessionListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.list"),
  result: WsSessionListResult,
});
export type WsSessionListResponseOkEnvelope = z.infer<typeof WsSessionListResponseOkEnvelope>;

export const WsSessionListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.list"),
});
export type WsSessionListResponseErrEnvelope = z.infer<typeof WsSessionListResponseErrEnvelope>;

export const WsSessionGetSession = z
  .object({
    session_id: z.string().trim().min(1),
    agent_id: AgentKey,
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    title: z.string().default(""),
    summary: z.string().default(""),
    turns: z.array(WsSessionTurn),
    updated_at: DateTimeSchema,
    created_at: DateTimeSchema,
  })
  .strict();
export type WsSessionGetSession = z.infer<typeof WsSessionGetSession>;

export const WsSessionGetResult = z
  .object({
    session: WsSessionGetSession,
  })
  .strict();
export type WsSessionGetResult = z.infer<typeof WsSessionGetResult>;

export const WsSessionGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.get"),
  result: WsSessionGetResult,
});
export type WsSessionGetResponseOkEnvelope = z.infer<typeof WsSessionGetResponseOkEnvelope>;

export const WsSessionGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.get"),
});
export type WsSessionGetResponseErrEnvelope = z.infer<typeof WsSessionGetResponseErrEnvelope>;

export const WsSessionCreateResult = z
  .object({
    session_id: z.string().trim().min(1),
    agent_id: AgentKey,
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    title: z.string().default(""),
  })
  .strict();
export type WsSessionCreateResult = z.infer<typeof WsSessionCreateResult>;

export const WsSessionCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.create"),
  result: WsSessionCreateResult,
});
export type WsSessionCreateResponseOkEnvelope = z.infer<typeof WsSessionCreateResponseOkEnvelope>;

export const WsSessionCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.create"),
});
export type WsSessionCreateResponseErrEnvelope = z.infer<typeof WsSessionCreateResponseErrEnvelope>;

export const WsSessionCompactResult = z
  .object({
    session_id: z.string().trim().min(1),
    dropped_messages: z.number().int().nonnegative(),
    kept_messages: z.number().int().nonnegative(),
  })
  .strict();
export type WsSessionCompactResult = z.infer<typeof WsSessionCompactResult>;

export const WsSessionCompactResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.compact"),
  result: WsSessionCompactResult,
});
export type WsSessionCompactResponseOkEnvelope = z.infer<typeof WsSessionCompactResponseOkEnvelope>;

export const WsSessionCompactResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.compact"),
});
export type WsSessionCompactResponseErrEnvelope = z.infer<
  typeof WsSessionCompactResponseErrEnvelope
>;

export const WsSessionDeleteResult = z
  .object({
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsSessionDeleteResult = z.infer<typeof WsSessionDeleteResult>;

export const WsSessionDeleteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("session.delete"),
  result: WsSessionDeleteResult,
});
export type WsSessionDeleteResponseOkEnvelope = z.infer<typeof WsSessionDeleteResponseOkEnvelope>;

export const WsSessionDeleteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("session.delete"),
});
export type WsSessionDeleteResponseErrEnvelope = z.infer<typeof WsSessionDeleteResponseErrEnvelope>;

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
