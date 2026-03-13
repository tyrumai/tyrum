import { randomUUID } from "node:crypto";
import { type UIMessage } from "ai";
import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import { resolveWorkspaceKey } from "../../modules/workspace/id.js";
import {
  createAiSdkChatStream,
  emitAiSdkChatChunk,
  failAiSdkChatStream,
  finishAiSdkChatStream,
  reconnectAiSdkChatStream,
} from "./ai-sdk-chat-streams.js";
import { handleSessionDeleteMessage } from "./session-delete-ops.js";
import {
  attachedNodeIdFromBody,
  canonicalizeUiMessage,
  canonicalizeUiMessages,
  ChatSessionCreateRequest,
  ChatSessionGetRequest,
  ChatSessionListRequest,
  ChatSessionReconnectRequest,
  ChatSessionSendRequest,
  hasApprovalRequest,
  normalizeRequestMetadata,
  requireTenantClient,
  resolveAuthoritativeTurnMessages,
  toPreview,
  toSessionSummary,
  toStoredChatMessages,
} from "./ai-sdk-chat-shared.js";

export async function handleAiSdkChatMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "chat.session.list") {
    return await handleChatSessionListMessage(client, msg, deps);
  }
  if (msg.type === "chat.session.get") {
    return await handleChatSessionGetMessage(client, msg, deps);
  }
  if (msg.type === "chat.session.create") {
    return await handleChatSessionCreateMessage(client, msg, deps);
  }
  if (msg.type === "chat.session.delete") {
    return await handleChatSessionDeleteMessage(client, msg, deps);
  }
  if (msg.type === "chat.session.reconnect") {
    return await handleChatSessionReconnectMessage(client, msg, deps);
  }
  if (msg.type === "chat.session.send") {
    return await handleChatSessionSendMessage(client, msg, deps);
  }
  return undefined;
}

async function handleChatSessionListMessage(
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

  const parsed = ChatSessionListRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const agentKey = parsed.data.payload.agent_id ?? "default";
  const connectorKey = parsed.data.payload.channel ?? "ui";

  try {
    const listed = await createSessionDal(deps).list({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      limit: parsed.data.payload.limit ?? 50,
      cursor: parsed.data.payload.cursor,
    });
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        sessions: listed.sessions.map((session) => ({
          agent_id: session.agent_id,
          channel: session.channel,
          created_at: session.created_at,
          last_message: toPreview(session.last_message),
          message_count: session.message_count,
          session_id: session.session_id,
          thread_id: session.thread_id,
          title: session.title,
          updated_at: session.updated_at,
        })),
        next_cursor: listed.nextCursor ?? null,
      },
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_session_list_failed",
      logFields: { agent_id: agentKey },
    });
  }
}

async function handleChatSessionGetMessage(
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

  const parsed = ChatSessionGetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const looked = await createSessionDal(deps).getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.session_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "session not found");
    }

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        session: {
          ...toSessionSummary({
            agentId: looked.agent_key,
            channel: looked.connector_key,
            createdAt: looked.session.created_at,
            messages: looked.session.messages,
            sessionId: looked.session.session_key,
            threadId: looked.provider_thread_id,
            title: looked.session.title,
            updatedAt: looked.session.updated_at,
          }),
          messages: looked.session.messages as unknown as UIMessage[],
        },
      },
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_session_get_failed",
      logFields: { session_id: parsed.data.payload.session_id },
    });
  }
}

async function handleChatSessionCreateMessage(
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

  const parsed = ChatSessionCreateRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const agentKey = parsed.data.payload.agent_id ?? "default";
  const connectorKey = parsed.data.payload.channel ?? "ui";

  try {
    const providerThreadId = `${connectorKey}-${randomUUID()}`;
    const session = await createSessionDal(deps).getOrCreate({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      providerThreadId,
      containerKind: "channel",
    });
    const looked = await createSessionDal(deps).getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: session.session_key,
    });
    if (!looked) {
      throw new Error("created session could not be reloaded");
    }
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        session: {
          ...toSessionSummary({
            agentId: agentKey,
            channel: connectorKey,
            createdAt: session.created_at,
            messages: session.messages,
            sessionId: session.session_key,
            threadId: looked.provider_thread_id,
            title: session.title,
            updatedAt: session.updated_at,
          }),
          thread_id: looked.provider_thread_id,
          messages: session.messages as unknown as UIMessage[],
        },
      },
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_session_create_failed",
      logFields: { agent_id: agentKey, channel: connectorKey },
    });
  }
}

async function handleChatSessionDeleteMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  return await handleSessionDeleteMessage(client, msg, deps);
}

async function handleChatSessionReconnectMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  _deps: ProtocolDeps,
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

async function handleChatSessionSendMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const auth = requireTenantClient(client, msg);
  if ("response" in auth) return auth.response;
  if (!deps.db || !deps.agents) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "chat transport is not available on this gateway instance",
    );
  }

  const parsed = ChatSessionSendRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const looked = await createSessionDal(deps).getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.session_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "session not found");
    }

    const persistedMessages = looked.session.messages as unknown as UIMessage[];
    const split = await resolveAuthoritativeTurnMessages({
      persistedMessages,
      submittedMessages: parsed.data.payload.messages,
      trigger: parsed.data.payload.trigger,
    });

    await createSessionDal(deps).replaceMessages({
      tenantId: auth.tenantId,
      sessionId: looked.session.session_id,
      messages: toStoredChatMessages(split.previousMessages),
      updatedAt: new Date().toISOString(),
    });

    const runtime = await deps.agents.getRuntime({
      tenantId: auth.tenantId,
      agentKey: looked.agent_key,
    });
    const requestMetadata = normalizeRequestMetadata({
      attachedNodeId: attachedNodeIdFromBody(parsed.data.payload.body),
      messageId: parsed.data.payload.message_id,
      metadata: parsed.data.payload.metadata,
      requestId: msg.request_id,
    });
    const turn = await runtime.turnStream({
      channel: looked.connector_key,
      thread_id: looked.provider_thread_id,
      message: split.userText,
      metadata: requestMetadata,
    });

    let approvalRequested = false;
    let completedMessages: UIMessage[] | null = null;
    const streamId = createAiSdkChatStream({
      agentId: looked.session.agent_id,
      clientId: client.id,
      sessionId: parsed.data.payload.session_id,
      tenantId: auth.tenantId,
    });
    const uiStream = turn.streamResult.toUIMessageStream<UIMessage>({
      generateMessageId: () => randomUUID(),
      originalMessages: split.originalMessages,
      onFinish: async (event) => {
        const responseMessage = canonicalizeUiMessage(event.responseMessage);
        const messages = canonicalizeUiMessages(event.messages);
        approvalRequested = hasApprovalRequest(responseMessage);
        completedMessages = messages;
        await createSessionDal(deps).replaceMessages({
          tenantId: auth.tenantId,
          sessionId: looked.session.session_id,
          messages: toStoredChatMessages(messages),
          updatedAt: new Date().toISOString(),
        });
      },
    });

    void (async () => {
      try {
        for await (const chunk of uiStream) {
          emitAiSdkChatChunk({
            chunk,
            connectionManager: deps.connectionManager,
            streamId,
          });
        }

        if (!approvalRequested) {
          await turn.finalize();
          if (completedMessages) {
            await createSessionDal(deps).replaceMessages({
              tenantId: auth.tenantId,
              sessionId: looked.session.session_id,
              messages: toStoredChatMessages(completedMessages),
              updatedAt: new Date().toISOString(),
            });
          }
        }

        finishAiSdkChatStream({
          connectionManager: deps.connectionManager,
          streamId,
        });
      } catch (err) {
        failAiSdkChatStream({
          connectionManager: deps.connectionManager,
          errorMessage: err instanceof Error ? err.message : String(err),
          streamId,
        });
      }
    })();

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: { stream_id: streamId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.error("ws.chat_session_send_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      session_id: parsed.data.payload.session_id,
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "agent_runtime_error", message);
  }
}
