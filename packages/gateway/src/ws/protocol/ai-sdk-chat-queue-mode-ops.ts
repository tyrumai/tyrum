import { QueueMode, type QueueMode as QueueModeT, type WsResponseEnvelope } from "@tyrum/contracts";
import { LaneQueueModeOverrideDal } from "../../app/modules/lanes/queue-mode-override-dal.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { ChatSessionQueueModeSetRequest, requireTenantClient } from "./ai-sdk-chat-shared.js";

const AI_SDK_CHAT_DEFAULT_QUEUE_MODE = "steer";
const AI_SDK_CHAT_MAIN_LANE = "main";

export async function ensureAiSdkChatSessionQueueMode(input: {
  db: NonNullable<ProtocolDeps["db"]>;
  sessionKey: string;
  tenantId: string;
}): Promise<QueueModeT> {
  const dal = new LaneQueueModeOverrideDal(input.db);
  const existing = await dal.get({
    tenant_id: input.tenantId,
    key: input.sessionKey,
    lane: AI_SDK_CHAT_MAIN_LANE,
  });
  const parsedExisting = QueueMode.safeParse(existing?.queue_mode);
  if (parsedExisting.success) {
    return parsedExisting.data;
  }

  const seeded = await dal.createIfAbsent({
    tenant_id: input.tenantId,
    key: input.sessionKey,
    lane: AI_SDK_CHAT_MAIN_LANE,
    queueMode: AI_SDK_CHAT_DEFAULT_QUEUE_MODE,
  });
  const parsedSeeded = QueueMode.safeParse(seeded.row.queue_mode);
  if (!parsedSeeded.success) {
    throw new Error("invalid chat session queue mode");
  }
  return parsedSeeded.data;
}

export async function handleChatSessionQueueModeSetMessage(
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

  const parsed = ChatSessionQueueModeSetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const session = await createSessionDal(deps).getByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.conversation_id,
    });
    if (!session) {
      return errorResponse(msg.request_id, msg.type, "not_found", "conversation not found");
    }

    const result = await new LaneQueueModeOverrideDal(deps.db).upsert({
      tenant_id: auth.tenantId,
      key: session.session_key,
      lane: AI_SDK_CHAT_MAIN_LANE,
      queueMode: parsed.data.payload.queue_mode,
    });
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation_id: session.session_key,
        queue_mode: QueueMode.parse(result.queue_mode),
      },
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_session_queue_mode_set_failed",
      logFields: { conversation_id: parsed.data.payload.conversation_id },
    });
  }
}
