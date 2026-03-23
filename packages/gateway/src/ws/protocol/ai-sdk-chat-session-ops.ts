import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { reconnectAiSdkChatStream } from "./ai-sdk-chat-streams.js";
import { ChatSessionReconnectRequest, requireTenantClient } from "./ai-sdk-chat-shared.js";
import type { ConnectedClient } from "../connection-manager.js";
import { IdentityScopeDal, requirePrimaryAgentKey } from "../../app/modules/identity/scope.js";
import type { WsResponseEnvelope } from "@tyrum/contracts";

export async function resolveChatAgentKey(input: {
  tenantId: string;
  requestedAgentKey?: string;
  deps: ProtocolDeps;
}): Promise<string> {
  if (input.requestedAgentKey !== undefined) {
    const normalized = input.requestedAgentKey.trim();
    if (!normalized) {
      throw new Error("agent_id must be a non-empty string");
    }
    return normalized;
  }
  if (!input.deps.db) {
    throw new Error("primary agent resolution requires db access");
  }
  const identityScopeDal =
    input.deps.identityScopeDal ?? new IdentityScopeDal(input.deps.db, { cacheTtlMs: 60_000 });
  return await requirePrimaryAgentKey(identityScopeDal, input.tenantId);
}

export async function handleChatSessionReconnectMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
): Promise<WsResponseEnvelope> {
  const auth = requireTenantClient(client, msg);
  if ("response" in auth) return auth.response;

  const parsed = ChatSessionReconnectRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const streamId = reconnectAiSdkChatStream({
    clientId: client.id,
    sessionId: parsed.data.payload.session_id,
    tenantId: auth.tenantId,
  });
  return {
    request_id: msg.request_id,
    type: msg.type,
    ok: true,
    result: streamId ? { stream_id: streamId } : null,
  };
}
