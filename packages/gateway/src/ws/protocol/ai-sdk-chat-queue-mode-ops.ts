import { QueueMode, type QueueMode as QueueModeT, type WsResponseEnvelope } from "@tyrum/contracts";
import { ConversationQueueModeOverrideDal } from "../../app/modules/conversation-queue/queue-mode-override-dal.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import {
  createConversationDal,
  conversationErrorResponse,
} from "./conversation-protocol-shared.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { ChatConversationQueueModeSetRequest, requireTenantClient } from "./ai-sdk-chat-shared.js";

const AI_SDK_CHAT_DEFAULT_QUEUE_MODE = "steer";
export async function ensureAiSdkChatConversationQueueMode(input: {
  db: NonNullable<ProtocolDeps["db"]>;
  conversationKey: string;
  tenantId: string;
}): Promise<QueueModeT> {
  const dal = new ConversationQueueModeOverrideDal(input.db);
  const existing = await dal.get({
    tenant_id: input.tenantId,
    key: input.conversationKey,
  });
  const parsedExisting = QueueMode.safeParse(existing?.queue_mode);
  if (parsedExisting.success) {
    return parsedExisting.data;
  }

  const seeded = await dal.createIfAbsent({
    tenant_id: input.tenantId,
    key: input.conversationKey,
    queueMode: AI_SDK_CHAT_DEFAULT_QUEUE_MODE,
  });
  const parsedSeeded = QueueMode.safeParse(seeded.row.queue_mode);
  if (!parsedSeeded.success) {
    throw new Error("invalid chat conversation queue mode");
  }
  return parsedSeeded.data;
}

export async function handleChatConversationQueueModeSetMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const auth = requireTenantClient(client, msg);
  if ("response" in auth) return auth.response;
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "conversation transport is not available on this gateway instance",
    );
  }

  const parsed = ChatConversationQueueModeSetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const conversation = await createConversationDal(deps).getByKey({
      tenantId: auth.tenantId,
      conversationKey: parsed.data.payload.conversation_id,
    });
    if (!conversation) {
      return errorResponse(msg.request_id, msg.type, "not_found", "conversation not found");
    }

    const result = await new ConversationQueueModeOverrideDal(deps.db).upsert({
      tenant_id: auth.tenantId,
      key: conversation.conversation_key,
      queueMode: parsed.data.payload.queue_mode,
    });
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation_id: conversation.conversation_key,
        queue_mode: QueueMode.parse(result.queue_mode),
      },
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_conversation_queue_mode_set_failed",
      logFields: { conversation_id: parsed.data.payload.conversation_id },
    });
  }
}
