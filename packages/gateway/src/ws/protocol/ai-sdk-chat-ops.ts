import { randomUUID } from "node:crypto";
import { type UIMessage } from "ai";
import { type WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import { resolveWorkspaceKey } from "../../app/modules/workspace/id.js";
import {
  createAiSdkChatStream,
  emitAiSdkChatChunk,
  failAiSdkChatStream,
  finishAiSdkChatStream,
} from "./ai-sdk-chat-streams.js";
import { handleChatSessionArchiveMessage } from "./session-archive-ops.js";
import { handleSessionDeleteMessage } from "./session-delete-ops.js";
import {
  attachedNodeIdFromBody,
  ChatSessionCreateRequest,
  ChatSessionGetRequest,
  ChatSessionListRequest,
  ChatSessionSendRequest,
  normalizeRequestMetadata,
  requireTenantClient,
  resolveAuthoritativeTurnMessages,
  validateSubmittedTurnMessages,
  toPreview,
  toSessionSummary,
  toStoredChatMessages,
} from "./ai-sdk-chat-shared.js";
import { materializeUiMessagesUploadedFiles } from "../../app/modules/ai-sdk/attachment-parts.js";
import type { ArtifactRecordInsertInput } from "../../app/modules/artifact/dal.js";
import {
  handleChatSessionReconnectMessage,
  resolveChatAgentKey,
} from "./ai-sdk-chat-session-ops.js";
import {
  ensureAiSdkChatSessionQueueMode,
  handleChatSessionQueueModeSetMessage,
} from "./ai-sdk-chat-queue-mode-ops.js";
import {
  findConversationKeysWithPausedApproval,
  projectConversationMessages,
} from "./ai-sdk-chat-projected-messages.js";

export async function handleAiSdkChatMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  switch (msg.type) {
    case "conversation.list":
      return await handleChatSessionListMessage(client, msg, deps);
    case "conversation.get":
      return await handleChatSessionGetMessage(client, msg, deps);
    case "conversation.create":
      return await handleChatSessionCreateMessage(client, msg, deps);
    case "conversation.delete":
      return await handleSessionDeleteMessage(client, msg, deps);
    case "conversation.archive":
      return await handleChatSessionArchiveMessage(client, msg, deps);
    case "conversation.queue_mode.set":
      return await handleChatSessionQueueModeSetMessage(client, msg, deps);
    case "conversation.reconnect":
      return await handleChatSessionReconnectMessage(client, msg);
    case "conversation.send":
      return await handleChatSessionSendMessage(client, msg, deps);
    default:
      return undefined;
  }
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
      "conversations are not available on this gateway instance",
    );
  }

  const parsed = ChatSessionListRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const connectorKey = parsed.data.payload.channel ?? "ui";
  const db = deps.db;
  let agentKey: string | undefined;

  try {
    agentKey = await resolveChatAgentKey({
      tenantId: auth.tenantId,
      requestedAgentKey: parsed.data.payload.agent_key,
      deps,
    });
    const sessionDal = createSessionDal(deps);
    const listed = await sessionDal.list({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      archived: parsed.data.payload.archived,
      limit: parsed.data.payload.limit ?? 50,
      cursor: parsed.data.payload.cursor,
    });
    const pausedKeys = await findConversationKeysWithPausedApproval({
      db,
      tenantId: auth.tenantId,
      conversationKeys: listed.sessions.map((session) => session.session_key),
    });
    const projectedSummaries = new Map<string, ReturnType<typeof toSessionSummary>>();

    await Promise.all(
      listed.sessions.map(async (session) => {
        if (!pausedKeys.has(session.session_key)) {
          return;
        }
        const looked = await sessionDal.getWithDeliveryByKey({
          tenantId: auth.tenantId,
          sessionKey: session.session_key,
        });
        if (!looked) {
          return;
        }
        const projectedMessages = await projectConversationMessages({
          approvalDal: deps.approvalDal,
          db,
          messages: looked.session.messages as unknown as UIMessage[],
          tenantId: auth.tenantId,
          conversationKey: looked.session.session_key,
        });
        if (projectedMessages.length === looked.session.messages.length) {
          return;
        }
        projectedSummaries.set(
          session.session_key,
          toSessionSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.session.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.session.created_at,
            messages: toStoredChatMessages(projectedMessages),
            conversationId: looked.session.session_key,
            threadId: looked.provider_thread_id,
            title: looked.session.title,
            updatedAt: looked.session.updated_at,
          }),
        );
      }),
    );

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversations: listed.sessions.map((session) => {
          const projected = projectedSummaries.get(session.session_key);
          if (projected) {
            return projected;
          }
          return {
            agent_key: session.agent_key,
            archived: session.archived,
            channel: session.channel,
            ...(session.account_key ? { account_key: session.account_key } : {}),
            created_at: session.created_at,
            last_message: toPreview(session.last_message),
            message_count: session.message_count,
            conversation_id: session.session_key,
            thread_id: session.thread_id,
            title: session.title,
            ...(session.container_kind ? { container_kind: session.container_kind } : {}),
            updated_at: session.updated_at,
          };
        }),
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
      logFields: { agent_key: agentKey },
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
      "conversations are not available on this gateway instance",
    );
  }

  const parsed = ChatSessionGetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const sessionDal = createSessionDal(deps);
    const looked = await sessionDal.getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.conversation_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "conversation not found");
    }
    const queueMode = await ensureAiSdkChatSessionQueueMode({
      db: deps.db,
      tenantId: auth.tenantId,
      sessionKey: looked.session.session_key,
    });
    const conversationMessages = await projectConversationMessages({
      approvalDal: deps.approvalDal,
      db: deps.db,
      messages: looked.session.messages as unknown as UIMessage[],
      tenantId: auth.tenantId,
      conversationKey: looked.session.session_key,
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation: {
          ...toSessionSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.session.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.session.created_at,
            messages: toStoredChatMessages(conversationMessages),
            conversationId: looked.session.session_key,
            threadId: looked.provider_thread_id,
            title: looked.session.title,
            updatedAt: looked.session.updated_at,
          }),
          queue_mode: queueMode,
          messages: conversationMessages,
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
      logFields: { conversation_id: parsed.data.payload.conversation_id },
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
      "conversations are not available on this gateway instance",
    );
  }

  const parsed = ChatSessionCreateRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const connectorKey = parsed.data.payload.channel ?? "ui";
  let agentKey: string | undefined;

  try {
    agentKey = await resolveChatAgentKey({
      tenantId: auth.tenantId,
      requestedAgentKey: parsed.data.payload.agent_key,
      deps,
    });
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
    const queueMode = await ensureAiSdkChatSessionQueueMode({
      db: deps.db,
      tenantId: auth.tenantId,
      sessionKey: looked.session.session_key,
    });
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation: {
          ...toSessionSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.session.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.session.created_at,
            messages: looked.session.messages,
            conversationId: looked.session.session_key,
            threadId: looked.provider_thread_id,
            title: looked.session.title,
            updatedAt: looked.session.updated_at,
          }),
          queue_mode: queueMode,
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
      logEvent: "ws.chat_session_create_failed",
      logFields: { agent_key: agentKey, channel: connectorKey },
    });
  }
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
      "conversation transport is not available on this gateway instance",
    );
  }

  const parsed = ChatSessionSendRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  try {
    const sessionDal = createSessionDal(deps);
    const looked = await sessionDal.getWithDeliveryByKey({
      tenantId: auth.tenantId,
      sessionKey: parsed.data.payload.conversation_id,
    });
    if (!looked) {
      return errorResponse(msg.request_id, msg.type, "not_found", "conversation not found");
    }

    if (looked.session.archived) {
      await sessionDal.setArchived({
        tenantId: auth.tenantId,
        sessionId: looked.session.session_id,
        archived: false,
      });
    }

    const persistedMessages = looked.session.messages as unknown as UIMessage[];
    const artifactRecords: ArtifactRecordInsertInput[] = [];
    const submittedMessages =
      parsed.data.payload.trigger === "submit-message"
        ? deps.artifactStore
          ? await materializeUiMessagesUploadedFiles(
              await validateSubmittedTurnMessages(parsed.data.payload.messages),
              deps.artifactStore,
              deps.artifactMaxUploadBytes,
              {
                tenantId: auth.tenantId,
                workspaceId: looked.session.workspace_id,
                agentId: looked.session.agent_id,
              },
              artifactRecords,
            )
          : await validateSubmittedTurnMessages(parsed.data.payload.messages)
        : undefined;
    const split = await resolveAuthoritativeTurnMessages({
      persistedMessages,
      submittedMessages,
      trigger: parsed.data.payload.trigger,
    });

    await sessionDal.replaceMessages({
      tenantId: auth.tenantId,
      sessionId: looked.session.session_id,
      messages: toStoredChatMessages(split.originalMessages),
      artifactRecords,
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
    const turn = await runtime.turnIngressStream({
      channel: looked.connector_key,
      thread_id: looked.provider_thread_id,
      parts: split.userParts,
      metadata: requestMetadata,
    });

    const streamId = createAiSdkChatStream({
      agentId: looked.session.agent_id,
      clientId: client.id,
      sessionId: parsed.data.payload.conversation_id,
      tenantId: auth.tenantId,
    });
    const uiStream = turn.streamResult.toUIMessageStream<UIMessage>({
      generateMessageId: () => randomUUID(),
      originalMessages: split.originalMessages,
      onFinish: () => undefined,
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

        const streamOutcome = await turn.outcome;
        if (streamOutcome === "completed") {
          await turn.finalize();
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
      conversation_id: parsed.data.payload.conversation_id,
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "agent_runtime_error", message);
  }
}
