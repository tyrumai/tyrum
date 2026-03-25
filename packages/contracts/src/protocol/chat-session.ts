import { z } from "zod";
import { DateTimeSchema } from "../common.js";
import { AgentKey, QueueMode } from "../keys.js";
import { TyrumUIMessage, TyrumUIMessageRole } from "../ui-message.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

export const WsChatSessionPreview = z
  .object({
    role: TyrumUIMessageRole,
    text: z.string(),
  })
  .strict();
export type WsChatSessionPreview = z.infer<typeof WsChatSessionPreview>;

export const WsChatSessionSummary = z
  .object({
    session_id: z.string().trim().min(1),
    agent_key: AgentKey,
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    title: z.string().default(""),
    message_count: z.number().int().nonnegative(),
    updated_at: DateTimeSchema,
    created_at: DateTimeSchema,
    last_message: WsChatSessionPreview.nullable().optional(),
    archived: z.boolean().default(false),
  })
  .strict();
export type WsChatSessionSummary = z.infer<typeof WsChatSessionSummary>;

export const WsChatSession = z
  .object({
    ...WsChatSessionSummary.shape,
    queue_mode: QueueMode,
    messages: z.array(TyrumUIMessage),
  })
  .strict();
export type WsChatSession = z.infer<typeof WsChatSession>;

export const WsChatSessionListPayload = z
  .object({
    agent_key: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
    cursor: z.string().trim().min(1).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type WsChatSessionListPayload = z.infer<typeof WsChatSessionListPayload>;

export const WsChatSessionListRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.list"),
  payload: WsChatSessionListPayload,
});
export type WsChatSessionListRequest = z.infer<typeof WsChatSessionListRequest>;

export const WsChatSessionListResult = z
  .object({
    sessions: z.array(WsChatSessionSummary),
    next_cursor: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type WsChatSessionListResult = z.infer<typeof WsChatSessionListResult>;

export const WsChatSessionGetPayload = z
  .object({
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsChatSessionGetPayload = z.infer<typeof WsChatSessionGetPayload>;

export const WsChatSessionGetRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.get"),
  payload: WsChatSessionGetPayload,
});
export type WsChatSessionGetRequest = z.infer<typeof WsChatSessionGetRequest>;

export const WsChatSessionGetResult = z
  .object({
    session: WsChatSession,
  })
  .strict();
export type WsChatSessionGetResult = z.infer<typeof WsChatSessionGetResult>;

export const WsChatSessionCreatePayload = z
  .object({
    agent_key: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsChatSessionCreatePayload = z.infer<typeof WsChatSessionCreatePayload>;

export const WsChatSessionCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.create"),
  payload: WsChatSessionCreatePayload,
});
export type WsChatSessionCreateRequest = z.infer<typeof WsChatSessionCreateRequest>;

export const WsChatSessionCreateResult = z
  .object({
    session: WsChatSession,
  })
  .strict();
export type WsChatSessionCreateResult = z.infer<typeof WsChatSessionCreateResult>;

export const WsChatSessionDeletePayload = z
  .object({
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsChatSessionDeletePayload = z.infer<typeof WsChatSessionDeletePayload>;

export const WsChatSessionDeleteRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.delete"),
  payload: WsChatSessionDeletePayload,
});
export type WsChatSessionDeleteRequest = z.infer<typeof WsChatSessionDeleteRequest>;

export const WsChatSessionDeleteResult = z
  .object({
    session_id: z.string().trim().min(1),
  })
  .strict();
export type WsChatSessionDeleteResult = z.infer<typeof WsChatSessionDeleteResult>;

export const WsChatSessionSendTrigger = z.enum(["submit-message", "regenerate-message"]);
export type WsChatSessionSendTrigger = z.infer<typeof WsChatSessionSendTrigger>;

export const WsChatSessionSendPayload = z
  .object({
    session_id: z.string().trim().min(1),
    message_id: z.string().trim().min(1).optional(),
    messages: z.array(TyrumUIMessage).optional(),
    trigger: WsChatSessionSendTrigger,
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type WsChatSessionSendPayload = z.infer<typeof WsChatSessionSendPayload>;

export const WsChatSessionSendRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.send"),
  payload: WsChatSessionSendPayload,
});
export type WsChatSessionSendRequest = z.infer<typeof WsChatSessionSendRequest>;

export const WsChatSessionStreamStart = z
  .object({
    stream_id: z.string().trim().min(1),
  })
  .strict();
export type WsChatSessionStreamStart = z.infer<typeof WsChatSessionStreamStart>;

export const WsChatSessionReconnectPayload = z
  .object({
    session_id: z.string().trim().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type WsChatSessionReconnectPayload = z.infer<typeof WsChatSessionReconnectPayload>;

export const WsChatSessionReconnectRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.reconnect"),
  payload: WsChatSessionReconnectPayload,
});
export type WsChatSessionReconnectRequest = z.infer<typeof WsChatSessionReconnectRequest>;

export const WsChatSessionReconnectResult = WsChatSessionStreamStart.nullable();
export type WsChatSessionReconnectResult = z.infer<typeof WsChatSessionReconnectResult>;

export const WsChatSessionListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.list"),
  result: WsChatSessionListResult,
});
export type WsChatSessionListResponseOkEnvelope = z.infer<
  typeof WsChatSessionListResponseOkEnvelope
>;

export const WsChatSessionListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.list"),
});
export type WsChatSessionListResponseErrEnvelope = z.infer<
  typeof WsChatSessionListResponseErrEnvelope
>;

export const WsChatSessionGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.get"),
  result: WsChatSessionGetResult,
});
export type WsChatSessionGetResponseOkEnvelope = z.infer<typeof WsChatSessionGetResponseOkEnvelope>;

export const WsChatSessionGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.get"),
});
export type WsChatSessionGetResponseErrEnvelope = z.infer<
  typeof WsChatSessionGetResponseErrEnvelope
>;

export const WsChatSessionCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.create"),
  result: WsChatSessionCreateResult,
});
export type WsChatSessionCreateResponseOkEnvelope = z.infer<
  typeof WsChatSessionCreateResponseOkEnvelope
>;

export const WsChatSessionCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.create"),
});
export type WsChatSessionCreateResponseErrEnvelope = z.infer<
  typeof WsChatSessionCreateResponseErrEnvelope
>;

export const WsChatSessionDeleteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.delete"),
  result: WsChatSessionDeleteResult,
});
export type WsChatSessionDeleteResponseOkEnvelope = z.infer<
  typeof WsChatSessionDeleteResponseOkEnvelope
>;

export const WsChatSessionDeleteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.delete"),
});
export type WsChatSessionDeleteResponseErrEnvelope = z.infer<
  typeof WsChatSessionDeleteResponseErrEnvelope
>;

export const WsChatSessionSendResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.send"),
  result: WsChatSessionStreamStart,
});
export type WsChatSessionSendResponseOkEnvelope = z.infer<
  typeof WsChatSessionSendResponseOkEnvelope
>;

export const WsChatSessionSendResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.send"),
});
export type WsChatSessionSendResponseErrEnvelope = z.infer<
  typeof WsChatSessionSendResponseErrEnvelope
>;

export const WsChatSessionReconnectResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.reconnect"),
  result: WsChatSessionReconnectResult,
});
export type WsChatSessionReconnectResponseOkEnvelope = z.infer<
  typeof WsChatSessionReconnectResponseOkEnvelope
>;

export const WsChatSessionReconnectResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.reconnect"),
});
export type WsChatSessionReconnectResponseErrEnvelope = z.infer<
  typeof WsChatSessionReconnectResponseErrEnvelope
>;

export const WsChatSessionQueueModeSetPayload = z
  .object({
    session_id: z.string().trim().min(1),
    queue_mode: QueueMode,
  })
  .strict();
export type WsChatSessionQueueModeSetPayload = z.infer<typeof WsChatSessionQueueModeSetPayload>;

export const WsChatSessionQueueModeSetRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.queue_mode.set"),
  payload: WsChatSessionQueueModeSetPayload,
});
export type WsChatSessionQueueModeSetRequest = z.infer<typeof WsChatSessionQueueModeSetRequest>;

export const WsChatSessionQueueModeSetResult = z
  .object({
    session_id: z.string().trim().min(1),
    queue_mode: QueueMode,
  })
  .strict();
export type WsChatSessionQueueModeSetResult = z.infer<typeof WsChatSessionQueueModeSetResult>;

export const WsChatSessionQueueModeSetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.queue_mode.set"),
  result: WsChatSessionQueueModeSetResult,
});
export type WsChatSessionQueueModeSetResponseOkEnvelope = z.infer<
  typeof WsChatSessionQueueModeSetResponseOkEnvelope
>;

export const WsChatSessionQueueModeSetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.queue_mode.set"),
});
export type WsChatSessionQueueModeSetResponseErrEnvelope = z.infer<
  typeof WsChatSessionQueueModeSetResponseErrEnvelope
>;

export const WsChatSessionArchivePayload = z
  .object({
    session_id: z.string().trim().min(1),
    archived: z.boolean(),
  })
  .strict();
export type WsChatSessionArchivePayload = z.infer<typeof WsChatSessionArchivePayload>;

export const WsChatSessionArchiveRequest = WsRequestEnvelope.extend({
  type: z.literal("chat.session.archive"),
  payload: WsChatSessionArchivePayload,
});
export type WsChatSessionArchiveRequest = z.infer<typeof WsChatSessionArchiveRequest>;

export const WsChatSessionArchiveResult = z
  .object({
    session_id: z.string().trim().min(1),
    archived: z.boolean(),
  })
  .strict();
export type WsChatSessionArchiveResult = z.infer<typeof WsChatSessionArchiveResult>;

export const WsChatSessionArchiveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("chat.session.archive"),
  result: WsChatSessionArchiveResult,
});
export type WsChatSessionArchiveResponseOkEnvelope = z.infer<
  typeof WsChatSessionArchiveResponseOkEnvelope
>;

export const WsChatSessionArchiveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("chat.session.archive"),
});
export type WsChatSessionArchiveResponseErrEnvelope = z.infer<
  typeof WsChatSessionArchiveResponseErrEnvelope
>;

export const WsAiSdkChatStreamEventPayload = z.discriminatedUnion("stage", [
  z
    .object({
      stream_id: z.string().trim().min(1),
      stage: z.literal("chunk"),
      chunk: z.unknown(),
    })
    .strict(),
  z
    .object({
      stream_id: z.string().trim().min(1),
      stage: z.literal("error"),
      error: z
        .object({
          message: z.string().trim().min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      stream_id: z.string().trim().min(1),
      stage: z.literal("done"),
    })
    .strict(),
]);
export type WsAiSdkChatStreamEventPayload = z.infer<typeof WsAiSdkChatStreamEventPayload>;

export const WsAiSdkChatStreamEvent = WsEventEnvelope.extend({
  type: z.literal("chat.ui-message.stream"),
  payload: WsAiSdkChatStreamEventPayload,
});
export type WsAiSdkChatStreamEvent = z.infer<typeof WsAiSdkChatStreamEvent>;
