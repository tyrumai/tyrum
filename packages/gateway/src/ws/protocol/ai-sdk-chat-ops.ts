import { randomUUID } from "node:crypto";
import { type UIMessage } from "ai";
import type { TyrumUIMessage, WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import {
  createConversationDal,
  conversationErrorResponse,
} from "./conversation-protocol-shared.js";
import { resolveWorkspaceKey } from "../../app/modules/workspace/id.js";
import {
  createAiSdkChatStream,
  emitAiSdkChatChunk,
  failAiSdkChatStream,
  finishAiSdkChatStream,
} from "./ai-sdk-chat-streams.js";
import { handleChatConversationArchiveMessage } from "./conversation-archive-ops.js";
import { handleConversationDeleteMessage } from "./conversation-delete-ops.js";
import {
  attachedNodeIdFromBody,
  ChatConversationCreateRequest,
  ChatConversationGetRequest,
  ChatConversationListRequest,
  ChatConversationSendRequest,
  normalizeRequestMetadata,
  requireTenantClient,
  resolveAuthoritativeTurnMessages,
  validateSubmittedTurnMessages,
  toPreview,
  toConversationSummary,
  toStoredChatMessages,
} from "./ai-sdk-chat-shared.js";
import { materializeUiMessagesUploadedFiles } from "../../app/modules/ai-sdk/attachment-parts.js";
import type { ArtifactRecordInsertInput } from "../../app/modules/artifact/dal.js";
import {
  handleChatConversationReconnectMessage,
  resolveChatAgentKey,
} from "./ai-sdk-chat-conversation-ops.js";
import {
  ensureAiSdkChatConversationQueueMode,
  handleChatConversationQueueModeSetMessage,
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
      return await handleChatConversationListMessage(client, msg, deps);
    case "conversation.get":
      return await handleChatConversationGetMessage(client, msg, deps);
    case "conversation.create":
      return await handleChatConversationCreateMessage(client, msg, deps);
    case "conversation.delete":
      return await handleConversationDeleteMessage(client, msg, deps);
    case "conversation.archive":
      return await handleChatConversationArchiveMessage(client, msg, deps);
    case "conversation.queue_mode.set":
      return await handleChatConversationQueueModeSetMessage(client, msg, deps);
    case "conversation.reconnect":
      return await handleChatConversationReconnectMessage(client, msg);
    case "conversation.send":
      return await handleChatConversationSendMessage(client, msg, deps);
    default:
      return undefined;
  }
}

async function handleChatConversationListMessage(
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

  const parsed = ChatConversationListRequest.safeParse(msg);
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
    const conversationDal = createConversationDal(deps);
    const listed = await conversationDal.list({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      archived: parsed.data.payload.archived,
      limit: parsed.data.payload.limit ?? 50,
      cursor: parsed.data.payload.cursor,
    });
    const pausedKeys = await findConversationKeysWithPausedApproval({
      db,
      tenantId: auth.tenantId,
      conversationKeys: listed.conversations.map((conversation) => conversation.conversation_key),
    });
    const projectedSummaries = new Map<string, ReturnType<typeof toConversationSummary>>();

    await Promise.all(
      listed.conversations.map(async (conversation) => {
        if (!pausedKeys.has(conversation.conversation_key)) {
          return;
        }
        const looked = await conversationDal.getWithDeliveryByKey({
          tenantId: auth.tenantId,
          conversationKey: conversation.conversation_key,
        });
        if (!looked) {
          return;
        }
        const projectedMessages = await projectConversationMessages({
          approvalDal: deps.approvalDal,
          db,
          messages: looked.conversation.messages,
          tenantId: auth.tenantId,
          conversationKey: looked.conversation.conversation_key,
        });
        if (projectedMessages.length === looked.conversation.messages.length) {
          return;
        }
        projectedSummaries.set(
          conversation.conversation_key,
          toConversationSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.conversation.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.conversation.created_at,
            messages: toStoredChatMessages(projectedMessages),
            conversationId: looked.conversation.conversation_key,
            threadId: looked.provider_thread_id,
            title: looked.conversation.title,
            updatedAt: looked.conversation.updated_at,
          }),
        );
      }),
    );

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversations: listed.conversations.map((conversation) => {
          const projected = projectedSummaries.get(conversation.conversation_key);
          if (projected) {
            return projected;
          }
          return {
            agent_key: conversation.agent_key,
            archived: conversation.archived,
            channel: conversation.channel,
            ...(conversation.account_key ? { account_key: conversation.account_key } : {}),
            created_at: conversation.created_at,
            last_message: toPreview(conversation.last_message),
            message_count: conversation.message_count,
            conversation_id: conversation.conversation_key,
            thread_id: conversation.thread_id,
            title: conversation.title,
            ...(conversation.container_kind ? { container_kind: conversation.container_kind } : {}),
            updated_at: conversation.updated_at,
          };
        }),
        next_cursor: listed.nextCursor ?? null,
      },
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_conversation_list_failed",
      logFields: { agent_key: agentKey },
    });
  }
}

async function handleChatConversationGetMessage(
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

  const parsed = ChatConversationGetRequest.safeParse(msg);
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
    const queueMode = await ensureAiSdkChatConversationQueueMode({
      db: deps.db,
      tenantId: auth.tenantId,
      conversationKey: looked.conversation.conversation_key,
    });
    const conversationMessages = await projectConversationMessages({
      approvalDal: deps.approvalDal,
      db: deps.db,
      messages: looked.conversation.messages,
      tenantId: auth.tenantId,
      conversationKey: looked.conversation.conversation_key,
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation: {
          ...toConversationSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.conversation.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.conversation.created_at,
            messages: toStoredChatMessages(conversationMessages),
            conversationId: looked.conversation.conversation_key,
            threadId: looked.provider_thread_id,
            title: looked.conversation.title,
            updatedAt: looked.conversation.updated_at,
          }),
          queue_mode: queueMode,
          messages: conversationMessages,
        },
      },
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_conversation_get_failed",
      logFields: { conversation_id: parsed.data.payload.conversation_id },
    });
  }
}

async function handleChatConversationCreateMessage(
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

  const parsed = ChatConversationCreateRequest.safeParse(msg);
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
    const conversation = await createConversationDal(deps).getOrCreate({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      providerThreadId,
      containerKind: "channel",
    });
    const looked = await createConversationDal(deps).getWithDeliveryByKey({
      tenantId: auth.tenantId,
      conversationKey: conversation.conversation_key,
    });
    if (!looked) {
      throw new Error("created conversation could not be reloaded");
    }
    const queueMode = await ensureAiSdkChatConversationQueueMode({
      db: deps.db,
      tenantId: auth.tenantId,
      conversationKey: looked.conversation.conversation_key,
    });
    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result: {
        conversation: {
          ...toConversationSummary({
            agentKey: looked.agent_key,
            accountKey: looked.account_key,
            archived: looked.conversation.archived,
            channel: looked.connector_key,
            containerKind: looked.container_kind,
            createdAt: looked.conversation.created_at,
            messages: looked.conversation.messages,
            conversationId: looked.conversation.conversation_key,
            threadId: looked.provider_thread_id,
            title: looked.conversation.title,
            updatedAt: looked.conversation.updated_at,
          }),
          queue_mode: queueMode,
          messages: looked.conversation.messages as unknown as UIMessage[],
        },
      },
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.chat_conversation_create_failed",
      logFields: { agent_key: agentKey, channel: connectorKey },
    });
  }
}

async function handleChatConversationSendMessage(
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

  const parsed = ChatConversationSendRequest.safeParse(msg);
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

    if (looked.conversation.archived) {
      await conversationDal.setArchived({
        tenantId: auth.tenantId,
        conversationId: looked.conversation.conversation_id,
        archived: false,
      });
    }

    const persistedMessages = looked.conversation.messages as unknown as UIMessage[];
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
                workspaceId: looked.conversation.workspace_id,
                agentId: looked.conversation.agent_id,
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

    await conversationDal.replaceMessages({
      tenantId: auth.tenantId,
      conversationId: looked.conversation.conversation_id,
      messages: toStoredChatMessages(split.originalMessages as unknown as TyrumUIMessage[]),
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
      agentId: looked.conversation.agent_id,
      clientId: client.id,
      conversationId: parsed.data.payload.conversation_id,
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
    deps.logger?.error("ws.chat_conversation_send_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      conversation_id: parsed.data.payload.conversation_id,
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "agent_runtime_error", message);
  }
}
