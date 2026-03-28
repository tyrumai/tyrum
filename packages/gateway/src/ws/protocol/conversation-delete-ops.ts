import {
  WsConversationDeleteRequest,
  WsConversationDeleteResult,
  type WsResponseEnvelope,
} from "@tyrum/contracts";
import { ConversationDal } from "../../app/modules/agent/conversation-dal.js";
import { resolveStoredKeyConversationScopeByChannelThread } from "../../app/modules/agent/stored-conversation-resolution.js";
import { ConversationSendPolicyOverrideDal } from "../../app/modules/channels/send-policy-override-dal.js";
import { ExecutionEngine } from "../../app/modules/execution/engine.js";
import { ConversationQueueModeOverrideDal } from "../../app/modules/conversation-queue/queue-mode-override-dal.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { createConversationDal, conversationErrorResponse } from "./conversation-protocol-shared.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleConversationDeleteMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may delete conversations",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "conversations are not available on this gateway instance",
    );
  }

  const parsedReq = WsConversationDeleteRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const conversationKey = parsedReq.data.payload.conversation_id;
  const looked = await lookupConversationForDelete({
    deps,
    tenantId,
    conversationKey,
    msg,
    client,
  });
  if ("response" in looked) {
    return looked.response;
  }

  const resolvedKey = await resolveDeleteConversationKey({
    deps,
    looked: looked.conversation,
    msg,
    client,
  });
  if ("response" in resolvedKey) {
    return resolvedKey.response;
  }

  await cleanupDeletedConversationExecution({
    deps,
    tenantId,
    key: resolvedKey.key,
    conversationKey,
    agentKey: looked.conversation.agent_key,
    msg,
    client,
  });

  const deleteResponse = await deleteConversationRows({
    deps,
    tenantId,
    conversationId: looked.conversation.conversation.conversation_id,
    key: resolvedKey.key,
    conversationKey,
    agentKey: looked.conversation.agent_key,
    msg,
    client,
  });
  if (deleteResponse) {
    return deleteResponse;
  }

  try {
    const result = WsConversationDeleteResult.parse({ conversation_id: conversationKey });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.conversation_delete_parse_failed",
      logFields: { conversation_id: conversationKey, agent_id: looked.conversation.agent_key },
    });
  }
}

async function lookupConversationForDelete(params: {
  deps: ProtocolDeps;
  tenantId: string;
  conversationKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<
  | { response: WsResponseEnvelope }
  | { conversation: NonNullable<Awaited<ReturnType<ConversationDal["getWithDeliveryByKey"]>>> }
> {
  const { deps, tenantId, conversationKey, msg, client } = params;
  try {
    const looked = await createConversationDal(deps).getWithDeliveryByKey({ tenantId, conversationKey });
    if (!looked) {
      return {
        response: errorResponse(msg.request_id, msg.type, "not_found", "conversation not found"),
      };
    }
    return { conversation: looked };
  } catch (err) {
    return {
      response: conversationErrorResponse({
        deps,
        err,
        msg,
        client,
        logEvent: "ws.conversation_delete_lookup_failed",
        logFields: { conversation_id: conversationKey },
      }),
    };
  }
}

async function resolveDeleteConversationKey(params: {
  deps: ProtocolDeps;
  looked: NonNullable<Awaited<ReturnType<ConversationDal["getWithDeliveryByKey"]>>>;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<{ response: WsResponseEnvelope } | { key: string }> {
  const { deps, looked, msg, client } = params;
  try {
    const resolved = (await resolveStoredKeyConversationScopeByChannelThread(deps.db!, {
      agentId: looked.agent_key,
      channel: looked.connector_key,
      threadId: looked.provider_thread_id,
    })) ?? { key: looked.conversation.conversation_key };

    return { key: resolved.key };
  } catch (err) {
    return {
      response: conversationErrorResponse({
        deps,
        err,
        msg,
        client,
        logEvent: "ws.conversation_delete_key_resolution_failed",
        logFields: { conversation_id: looked.conversation.conversation_key, agent_id: looked.agent_key },
      }),
    };
  }
}

async function cleanupDeletedConversationExecution(params: {
  deps: ProtocolDeps;
  tenantId: string;
  key: string;
  conversationKey: string;
  agentKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<void> {
  const { deps, tenantId, key, conversationKey, agentKey, msg, client } = params;
  try {
    const engine =
      deps.engine ??
      new ExecutionEngine({
        db: deps.db!,
        policyService: deps.policyService,
        redactionEngine: deps.redactionEngine,
        logger: deps.logger,
        eventsEnabled: true,
      });

    const activeRuns = await deps.db!.all<{ turn_id: string }>(
      `SELECT turn_id AS turn_id
       FROM turns
       WHERE tenant_id = ? AND conversation_key = ? AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC`,
      [tenantId, key],
    );
    for (const row of activeRuns) {
      await engine.cancelTurn(row.turn_id, "deleted by conversation.delete");
    }

    await deps.db!.run(
      `UPDATE channel_inbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = COALESCE(processed_at, ?),
           error = COALESCE(error, ?),
           reply_text = COALESCE(reply_text, '')
       WHERE tenant_id = ? AND status = 'queued' AND key = ?`,
      [new Date().toISOString(), "cancelled by conversation.delete", tenantId, key],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("ws.conversation_delete.cleanup_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      conversation_id: conversationKey,
      agent_id: agentKey,
      error: message,
    });
  }
}

async function deleteConversationRows(params: {
  deps: ProtocolDeps;
  tenantId: string;
  conversationId: string;
  key: string;
  conversationKey: string;
  agentKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<WsResponseEnvelope | undefined> {
  const { deps, tenantId, conversationId, key, conversationKey, agentKey, msg, client } = params;
  try {
    await deps.db!.transaction(async (tx) => {
      await tx.run(
        `DELETE FROM conversation_model_overrides
         WHERE tenant_id = ? AND conversation_id = ?`,
        [tenantId, conversationId],
      );
      await tx.run(
        `DELETE FROM conversation_provider_pins
         WHERE tenant_id = ? AND conversation_id = ?`,
        [tenantId, conversationId],
      );
      await new ConversationQueueModeOverrideDal(tx).clear({ tenant_id: tenantId, key });
      await new ConversationSendPolicyOverrideDal(tx).clear({ tenant_id: tenantId, key });
      await tx.run(
        `DELETE FROM conversations
         WHERE tenant_id = ? AND conversation_id = ?`,
        [tenantId, conversationId],
      );
    });
    return undefined;
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.conversation_delete_failed",
      logFields: { conversation_id: conversationKey, agent_id: agentKey },
    });
  }
}
