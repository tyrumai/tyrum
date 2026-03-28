import type { WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import {
  createConversationDal,
  conversationErrorResponse,
} from "./conversation-protocol-shared.js";
import { ChatConversationArchiveRequest, requireTenantClient } from "./ai-sdk-chat-shared.js";

export async function handleChatConversationArchiveMessage(
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
      "conversations are not available on this gateway instance",
    );
  }

  const parsed = ChatConversationArchiveRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const conversationDal = createConversationDal(deps);
    const looked = await conversationDal.getWithDeliveryByKey({
      tenantId: auth.tenantId,
      conversationKey: parsed.data.payload.conversation_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "conversation not found");
    }

    await conversationDal.setArchived({
      tenantId: auth.tenantId,
      conversationId: looked.conversation.conversation_id,
      archived: parsed.data.payload.archived,
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation_id: parsed.data.payload.conversation_id,
        archived: parsed.data.payload.archived,
      },
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_conversation_archive_failed",
      logFields: { conversation_id: parsed.data.payload.conversation_id },
    });
  }
}
