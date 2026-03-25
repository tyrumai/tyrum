import { z } from "zod";
import { DateTimeSchema } from "../common.js";
import { NormalizedContainerKind } from "../message.js";
import { AccountId, AgentKey, QueueMode } from "../keys.js";
import { TyrumUIMessage, TyrumUIMessageRole } from "../ui-message.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

export const WsConversationPreview = z
  .object({
    role: TyrumUIMessageRole,
    text: z.string(),
  })
  .strict();
export type WsConversationPreview = z.infer<typeof WsConversationPreview>;

export const WsConversationSummary = z
  .object({
    conversation_id: z.string().trim().min(1),
    agent_key: AgentKey,
    channel: z.string().trim().min(1),
    account_key: AccountId.optional(),
    thread_id: z.string().trim().min(1),
    container_kind: NormalizedContainerKind.optional(),
    title: z.string().default(""),
    message_count: z.number().int().nonnegative(),
    updated_at: DateTimeSchema,
    created_at: DateTimeSchema,
    last_message: WsConversationPreview.nullable().optional(),
    archived: z.boolean().default(false),
  })
  .strict();
export type WsConversationSummary = z.infer<typeof WsConversationSummary>;

export const WsConversation = z
  .object({
    ...WsConversationSummary.shape,
    queue_mode: QueueMode,
    messages: z.array(TyrumUIMessage),
  })
  .strict();
export type WsConversation = z.infer<typeof WsConversation>;

export const WsConversationListPayload = z
  .object({
    agent_key: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(200).optional(),
    cursor: z.string().trim().min(1).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type WsConversationListPayload = z.infer<typeof WsConversationListPayload>;

export const WsConversationListRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.list"),
  payload: WsConversationListPayload,
});
export type WsConversationListRequest = z.infer<typeof WsConversationListRequest>;

export const WsConversationListResult = z
  .object({
    conversations: z.array(WsConversationSummary),
    next_cursor: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type WsConversationListResult = z.infer<typeof WsConversationListResult>;

export const WsConversationGetPayload = z
  .object({
    conversation_id: z.string().trim().min(1),
  })
  .strict();
export type WsConversationGetPayload = z.infer<typeof WsConversationGetPayload>;

export const WsConversationGetRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.get"),
  payload: WsConversationGetPayload,
});
export type WsConversationGetRequest = z.infer<typeof WsConversationGetRequest>;

export const WsConversationGetResult = z
  .object({
    conversation: WsConversation,
  })
  .strict();
export type WsConversationGetResult = z.infer<typeof WsConversationGetResult>;

export const WsConversationCreatePayload = z
  .object({
    agent_key: AgentKey.optional(),
    channel: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsConversationCreatePayload = z.infer<typeof WsConversationCreatePayload>;

export const WsConversationCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.create"),
  payload: WsConversationCreatePayload,
});
export type WsConversationCreateRequest = z.infer<typeof WsConversationCreateRequest>;

export const WsConversationCreateResult = z
  .object({
    conversation: WsConversation,
  })
  .strict();
export type WsConversationCreateResult = z.infer<typeof WsConversationCreateResult>;

export const WsConversationDeletePayload = z
  .object({
    conversation_id: z.string().trim().min(1),
  })
  .strict();
export type WsConversationDeletePayload = z.infer<typeof WsConversationDeletePayload>;

export const WsConversationDeleteRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.delete"),
  payload: WsConversationDeletePayload,
});
export type WsConversationDeleteRequest = z.infer<typeof WsConversationDeleteRequest>;

export const WsConversationDeleteResult = z
  .object({
    conversation_id: z.string().trim().min(1),
  })
  .strict();
export type WsConversationDeleteResult = z.infer<typeof WsConversationDeleteResult>;

export const WsConversationSendTrigger = z.enum(["submit-message", "regenerate-message"]);
export type WsConversationSendTrigger = z.infer<typeof WsConversationSendTrigger>;

export const WsConversationSendPayload = z
  .object({
    conversation_id: z.string().trim().min(1),
    message_id: z.string().trim().min(1).optional(),
    messages: z.array(TyrumUIMessage).optional(),
    trigger: WsConversationSendTrigger,
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type WsConversationSendPayload = z.infer<typeof WsConversationSendPayload>;

export const WsConversationSendRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.send"),
  payload: WsConversationSendPayload,
});
export type WsConversationSendRequest = z.infer<typeof WsConversationSendRequest>;

export const WsConversationStreamStart = z
  .object({
    stream_id: z.string().trim().min(1),
  })
  .strict();
export type WsConversationStreamStart = z.infer<typeof WsConversationStreamStart>;

export const WsConversationReconnectPayload = z
  .object({
    conversation_id: z.string().trim().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();
export type WsConversationReconnectPayload = z.infer<typeof WsConversationReconnectPayload>;

export const WsConversationReconnectRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.reconnect"),
  payload: WsConversationReconnectPayload,
});
export type WsConversationReconnectRequest = z.infer<typeof WsConversationReconnectRequest>;

export const WsConversationReconnectResult = WsConversationStreamStart.nullable();
export type WsConversationReconnectResult = z.infer<typeof WsConversationReconnectResult>;

export const WsConversationListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.list"),
  result: WsConversationListResult,
});
export type WsConversationListResponseOkEnvelope = z.infer<
  typeof WsConversationListResponseOkEnvelope
>;

export const WsConversationListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.list"),
});
export type WsConversationListResponseErrEnvelope = z.infer<
  typeof WsConversationListResponseErrEnvelope
>;

export const WsConversationGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.get"),
  result: WsConversationGetResult,
});
export type WsConversationGetResponseOkEnvelope = z.infer<
  typeof WsConversationGetResponseOkEnvelope
>;

export const WsConversationGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.get"),
});
export type WsConversationGetResponseErrEnvelope = z.infer<
  typeof WsConversationGetResponseErrEnvelope
>;

export const WsConversationCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.create"),
  result: WsConversationCreateResult,
});
export type WsConversationCreateResponseOkEnvelope = z.infer<
  typeof WsConversationCreateResponseOkEnvelope
>;

export const WsConversationCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.create"),
});
export type WsConversationCreateResponseErrEnvelope = z.infer<
  typeof WsConversationCreateResponseErrEnvelope
>;

export const WsConversationDeleteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.delete"),
  result: WsConversationDeleteResult,
});
export type WsConversationDeleteResponseOkEnvelope = z.infer<
  typeof WsConversationDeleteResponseOkEnvelope
>;

export const WsConversationDeleteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.delete"),
});
export type WsConversationDeleteResponseErrEnvelope = z.infer<
  typeof WsConversationDeleteResponseErrEnvelope
>;

export const WsConversationSendResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.send"),
  result: WsConversationStreamStart,
});
export type WsConversationSendResponseOkEnvelope = z.infer<
  typeof WsConversationSendResponseOkEnvelope
>;

export const WsConversationSendResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.send"),
});
export type WsConversationSendResponseErrEnvelope = z.infer<
  typeof WsConversationSendResponseErrEnvelope
>;

export const WsConversationReconnectResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.reconnect"),
  result: WsConversationReconnectResult,
});
export type WsConversationReconnectResponseOkEnvelope = z.infer<
  typeof WsConversationReconnectResponseOkEnvelope
>;

export const WsConversationReconnectResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.reconnect"),
});
export type WsConversationReconnectResponseErrEnvelope = z.infer<
  typeof WsConversationReconnectResponseErrEnvelope
>;

export const WsConversationQueueModeSetPayload = z
  .object({
    conversation_id: z.string().trim().min(1),
    queue_mode: QueueMode,
  })
  .strict();
export type WsConversationQueueModeSetPayload = z.infer<typeof WsConversationQueueModeSetPayload>;

export const WsConversationQueueModeSetRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.queue_mode.set"),
  payload: WsConversationQueueModeSetPayload,
});
export type WsConversationQueueModeSetRequest = z.infer<typeof WsConversationQueueModeSetRequest>;

export const WsConversationQueueModeSetResult = z
  .object({
    conversation_id: z.string().trim().min(1),
    queue_mode: QueueMode,
  })
  .strict();
export type WsConversationQueueModeSetResult = z.infer<typeof WsConversationQueueModeSetResult>;

export const WsConversationQueueModeSetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.queue_mode.set"),
  result: WsConversationQueueModeSetResult,
});
export type WsConversationQueueModeSetResponseOkEnvelope = z.infer<
  typeof WsConversationQueueModeSetResponseOkEnvelope
>;

export const WsConversationQueueModeSetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.queue_mode.set"),
});
export type WsConversationQueueModeSetResponseErrEnvelope = z.infer<
  typeof WsConversationQueueModeSetResponseErrEnvelope
>;

export const WsConversationArchivePayload = z
  .object({
    conversation_id: z.string().trim().min(1),
    archived: z.boolean(),
  })
  .strict();
export type WsConversationArchivePayload = z.infer<typeof WsConversationArchivePayload>;

export const WsConversationArchiveRequest = WsRequestEnvelope.extend({
  type: z.literal("conversation.archive"),
  payload: WsConversationArchivePayload,
});
export type WsConversationArchiveRequest = z.infer<typeof WsConversationArchiveRequest>;

export const WsConversationArchiveResult = z
  .object({
    conversation_id: z.string().trim().min(1),
    archived: z.boolean(),
  })
  .strict();
export type WsConversationArchiveResult = z.infer<typeof WsConversationArchiveResult>;

export const WsConversationArchiveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("conversation.archive"),
  result: WsConversationArchiveResult,
});
export type WsConversationArchiveResponseOkEnvelope = z.infer<
  typeof WsConversationArchiveResponseOkEnvelope
>;

export const WsConversationArchiveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("conversation.archive"),
});
export type WsConversationArchiveResponseErrEnvelope = z.infer<
  typeof WsConversationArchiveResponseErrEnvelope
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
