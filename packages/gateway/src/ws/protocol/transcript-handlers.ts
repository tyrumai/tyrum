import type {
  TranscriptConversationSummary,
  TranscriptTimelineEvent,
  WsResponseEnvelope,
} from "@tyrum/contracts";
import {
  WsTranscriptGetRequest,
  WsTranscriptGetResult,
  WsTranscriptListRequest,
  WsTranscriptListResult,
} from "@tyrum/contracts";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { toSubagent } from "../../app/modules/workboard/dal-helpers.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { resolveChatAgentKey } from "./ai-sdk-chat-conversation-ops.js";
import {
  createConversationDal,
  conversationErrorResponse,
} from "./conversation-protocol-shared.js";
import {
  loadDescendantConversationRecords,
  loadLineageSubagentRows,
  listChildConversationRecords,
  listConversationRecords,
  listSubagentRows,
  resolveWorkspaceId,
} from "./transcript-handlers.data.js";
import {
  buildLatestTurnInfoByKey,
  buildTranscriptConversationSummaries,
  attachDirectChildSummaries,
  loadPendingApprovalCountByKey,
  loadTurnDetailsByKey,
  loadApprovalLinkIdsByTurnIds,
  shouldKeepTranscriptRootSummary,
} from "./transcript-handlers.turns.js";
import {
  compareTimelineEvents,
  readMessageOccurredAt,
  resolveApprovalEvents,
  resolveContextReportEvents,
  resolveToolLifecycleEvents,
} from "./transcript-handlers.timeline.js";
import type { ConversationLineageRecord } from "./transcript-handlers.types.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

const MAX_ACTIVE_ONLY_SCAN_PAGES = 10;
export async function handleTranscriptMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "transcript.list") {
    return await handleTranscriptListMessage(client, msg, deps);
  }
  if (msg.type === "transcript.get") {
    return await handleTranscriptGetMessage(client, msg, deps);
  }
  return undefined;
}

async function handleTranscriptListMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may list transcripts",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "transcript.list not supported",
    );
  }

  const parsed = WsTranscriptListRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  try {
    const { identityScopeDal, workspaceId } = await resolveWorkspaceId(deps, tenantId);
    const agentKey = parsed.data.payload.agent_key
      ? await resolveChatAgentKey({
          tenantId,
          requestedAgentKey: parsed.data.payload.agent_key,
          deps,
        })
      : undefined;
    if (agentKey) {
      const agentId = await identityScopeDal.resolveAgentId(tenantId, agentKey);
      if (!agentId) {
        return errorResponse(msg.request_id, msg.type, "not_found", "agent not found");
      }
    }

    const activeOnly = parsed.data.payload.active_only === true;
    const limit = parsed.data.payload.limit ?? 200;
    let cursor = parsed.data.payload.cursor;
    let scannedPages = 0;

    while (true) {
      scannedPages += 1;
      const listedRoots = await listConversationRecords({
        deps,
        tenantId,
        workspaceId,
        agentKey,
        channel: parsed.data.payload.channel,
        archived: parsed.data.payload.archived,
        limit,
        cursor,
      });
      const rootConversationKeys = listedRoots.conversations.map(
        (conversation) => conversation.conversationKey,
      );
      const childConversations = activeOnly
        ? await loadDescendantConversationRecords({
            deps,
            tenantId,
            workspaceId,
            parentConversationKeys: rootConversationKeys,
          })
        : await listChildConversationRecords({
            deps,
            tenantId,
            workspaceId,
            rootConversationKeys,
          });
      const conversations = [...listedRoots.conversations, ...childConversations];
      const conversationKeys = conversations.map((conversation) => conversation.conversationKey);
      const subagentRows = await listSubagentRows({
        deps,
        tenantId,
        workspaceId,
        conversationKeys,
      });
      const turnDetailsByKey = await loadTurnDetailsByKey({
        deps,
        tenantId,
        keys: conversationKeys,
      });
      const summaries = buildTranscriptConversationSummaries({
        conversations,
        subagentsByConversationKey: new Map(subagentRows.map((row) => [row.conversation_key, row])),
        latestTurnsByKey: buildLatestTurnInfoByKey(turnDetailsByKey),
        pendingApprovalsByKey: await loadPendingApprovalCountByKey({
          deps,
          tenantId,
          keys: conversationKeys,
        }),
      });
      const summariesByConversationKey = new Map(
        summaries.map((summary) => [summary.conversation_key, summary] as const),
      );
      const roots = listedRoots.conversations
        .map((conversation) => summariesByConversationKey.get(conversation.conversationKey))
        .filter((summary): summary is TranscriptConversationSummary => summary !== undefined);
      const children = childConversations
        .map((conversation) => summariesByConversationKey.get(conversation.conversationKey))
        .filter((summary): summary is TranscriptConversationSummary => summary !== undefined);
      const attached = attachDirectChildSummaries({ roots, children }).filter((summary) =>
        shouldKeepTranscriptRootSummary(summary, activeOnly),
      );

      if (
        activeOnly &&
        attached.length === 0 &&
        listedRoots.nextCursor &&
        scannedPages < MAX_ACTIVE_ONLY_SCAN_PAGES
      ) {
        cursor = listedRoots.nextCursor;
        continue;
      }

      return {
        request_id: msg.request_id,
        type: msg.type,
        ok: true,
        result: WsTranscriptListResult.parse({
          conversations: attached,
          next_cursor: listedRoots.nextCursor,
        }),
      };
    }
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.transcript_list_failed",
      invalidCursor: err instanceof Error && err.message === "invalid cursor",
    });
  }
}

async function handleTranscriptGetMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may fetch transcripts",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "transcript.get not supported",
    );
  }

  const parsed = WsTranscriptGetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  try {
    const conversationDal = createConversationDal(deps);
    const focus = await conversationDal.getWithDeliveryByKey({
      tenantId,
      conversationKey: parsed.data.payload.conversation_key,
    });
    if (!focus) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        "transcript conversation not found",
      );
    }

    const workspaceId = focus.conversation.workspace_id;
    const { subagentRows, rootConversationKey, lineageKeys } = await loadLineageSubagentRows({
      deps,
      tenantId,
      workspaceId,
      focusConversationKey: focus.conversation.conversation_key,
    });
    const subagentByConversationKey = new Map(
      subagentRows.map((row) => [row.conversation_key, row]),
    );
    const childRowsByParentKey = new Map<string, RawSubagentRow[]>();
    for (const row of subagentRows) {
      if (!row.parent_conversation_key) {
        continue;
      }
      const current = childRowsByParentKey.get(row.parent_conversation_key) ?? [];
      current.push(row);
      childRowsByParentKey.set(row.parent_conversation_key, current);
    }

    const seenKeys = new Set<string>(lineageKeys);

    const lineageConversations: ConversationLineageRecord[] = [];
    for (const conversationKey of lineageKeys) {
      const loaded = await conversationDal.getWithDeliveryByKey({
        tenantId,
        conversationKey,
      });
      if (!loaded) {
        continue;
      }
      lineageConversations.push({
        conversationId: loaded.conversation.conversation_id,
        conversationKey: loaded.conversation.conversation_key,
        agentKey: loaded.agent_key,
        channel: loaded.connector_key,
        accountKey: loaded.account_key ?? null,
        threadId: loaded.provider_thread_id,
        containerKind: loaded.container_kind ?? null,
        title: loaded.conversation.title,
        messageCount: loaded.conversation.messages.length,
        updatedAt: loaded.conversation.updated_at,
        createdAt: loaded.conversation.created_at,
        archived: loaded.conversation.archived,
        messages: loaded.conversation.messages,
      });
    }

    const turnDetailsByKey = await loadTurnDetailsByKey({
      deps,
      tenantId,
      keys: lineageConversations.map((conversation) => conversation.conversationKey),
    });
    const summaries = buildTranscriptConversationSummaries({
      conversations: lineageConversations,
      subagentsByConversationKey: subagentByConversationKey,
      latestTurnsByKey: buildLatestTurnInfoByKey(turnDetailsByKey),
      pendingApprovalsByKey: await loadPendingApprovalCountByKey({
        deps,
        tenantId,
        keys: lineageConversations.map((conversation) => conversation.conversationKey),
      }),
    });
    const summaryByConversationKey = new Map(
      summaries.map((summary) => [summary.conversation_key, summary] as const),
    );
    const conversationIds = lineageConversations.map((conversation) => conversation.conversationId);
    const conversationKeyByConversationId = new Map(
      lineageConversations.map(
        (conversation) => [conversation.conversationId, conversation.conversationKey] as const,
      ),
    );

    const conversationKeyByRunId = new Map<string, string>();
    const runIds: string[] = [];
    const events: TranscriptTimelineEvent[] = [];

    for (const conversation of lineageConversations) {
      const summary = summaryByConversationKey.get(conversation.conversationKey);
      for (const message of conversation.messages) {
        events.push({
          event_id: `message:${conversation.conversationKey}:${message.id}`,
          kind: "message",
          occurred_at: readMessageOccurredAt(message, conversation.updatedAt),
          conversation_key: conversation.conversationKey,
          parent_conversation_key: summary?.parent_conversation_key,
          subagent_id: summary?.subagent_id,
          payload: { message },
        });
      }
    }

    for (const [conversationKey, details] of turnDetailsByKey) {
      const summary = summaryByConversationKey.get(conversationKey);
      for (const detail of details) {
        runIds.push(detail.turn.turn_id);
        conversationKeyByRunId.set(detail.turn.turn_id, conversationKey);
        events.push({
          event_id: `turn:${detail.turn.turn_id}`,
          kind: "turn",
          occurred_at: detail.turn.created_at,
          conversation_key: conversationKey,
          parent_conversation_key: summary?.parent_conversation_key,
          subagent_id: summary?.subagent_id,
          payload: {
            turn: detail.turn,
            turn_items: detail.turnItems,
          },
        });
      }
    }

    for (const row of subagentRows) {
      if (!seenKeys.has(row.conversation_key)) {
        continue;
      }
      const subagent = toSubagent(row);
      const summary = summaryByConversationKey.get(row.conversation_key);
      events.push({
        event_id: `subagent:${row.subagent_id}:spawned`,
        kind: "subagent",
        occurred_at: subagent.created_at,
        conversation_key: row.conversation_key,
        parent_conversation_key: summary?.parent_conversation_key,
        subagent_id: subagent.subagent_id,
        payload: {
          phase: "spawned",
          subagent,
        },
      });
      if (subagent.closed_at) {
        events.push({
          event_id: `subagent:${row.subagent_id}:closed`,
          kind: "subagent",
          occurred_at: subagent.closed_at,
          conversation_key: row.conversation_key,
          parent_conversation_key: summary?.parent_conversation_key,
          subagent_id: subagent.subagent_id,
          payload: {
            phase: "closed",
            subagent,
          },
        });
      }
    }

    const approvalLinkIds = await loadApprovalLinkIdsByTurnIds({
      deps,
      tenantId,
      turnIds: runIds,
    });

    events.push(
      ...(await resolveToolLifecycleEvents({
        deps,
        tenantId,
        conversationIds,
        conversationKeyByConversationId,
        summaryByConversationKey,
      })),
      ...(await resolveContextReportEvents({
        deps,
        tenantId,
        conversationIds,
        conversationKeyByConversationId,
        summaryByConversationKey,
      })),
      ...(await resolveApprovalEvents({
        deps,
        tenantId,
        conversationIds,
        conversationKeyByTurnId: conversationKeyByRunId,
        workflowRunStepIds: approvalLinkIds.workflowRunStepIds,
        turnIds: runIds,
        summaryByConversationKey: summaryByConversationKey,
      })),
    );

    const result = WsTranscriptGetResult.parse({
      root_conversation_key: rootConversationKey,
      focus_conversation_key: focus.conversation.conversation_key,
      conversations: summaries,
      events: events.toSorted(compareTimelineEvents),
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result,
    };
  } catch (err) {
    return conversationErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.transcript_get_failed",
      logFields: { conversation_key: parsed.data.payload.conversation_key },
    });
  }
}
