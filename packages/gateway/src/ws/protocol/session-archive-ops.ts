import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import { ChatSessionArchiveRequest, requireTenantClient } from "./ai-sdk-chat-shared.js";

export async function handleChatSessionArchiveMessage(
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
      "sessions are not available on this gateway instance",
    );
  }

  const parsed = ChatSessionArchiveRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const sessionDal = createSessionDal(deps);
    const looked = await sessionDal.getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.session_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "session not found");
    }

    await sessionDal.setArchived({
      tenantId: auth.tenantId,
      sessionId: looked.session.session_id,
      archived: parsed.data.payload.archived,
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        session_id: parsed.data.payload.session_id,
        archived: parsed.data.payload.archived,
      },
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_session_archive_failed",
      logFields: { session_id: parsed.data.payload.session_id },
    });
  }
}
