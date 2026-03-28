import type { TyrumUIMessage } from "@tyrum/contracts";
import { stringifyPersistedJson } from "../observability/persisted-json.js";
import {
  type ConversationState,
  createEmptyConversationContextState,
  CONVERSATION_CONTEXT_STATE_JSON_META,
  CONVERSATION_MESSAGES_JSON_META,
  isChatMessageArray,
  isConversationContextState,
} from "./conversation-dal-helpers.js";

export function encodeConversationCursor(input: {
  updated_at: string;
  conversation_id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ updated_at: input.updated_at, conversation_id: input.conversation_id }),
    "utf-8",
  ).toString("base64url");
}

export function decodeConversationCursor(
  cursor: string,
): { updated_at: string; conversation_id: string } | undefined {
  const trimmed = cursor.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const { updated_at: updatedAt, conversation_id: conversationId } = parsed as Record<
      string,
      unknown
    >;
    return typeof updatedAt === "string" &&
      updatedAt.trim().length > 0 &&
      typeof conversationId === "string" &&
      conversationId.trim().length > 0
      ? { updated_at: updatedAt, conversation_id: conversationId }
      : undefined;
  } catch {
    // Intentional: invalid cursors should behave the same as an omitted cursor.
    return undefined;
  }
}

export function stringifyConversationContextState(state: ConversationState): string {
  return stringifyPersistedJson({
    value: state,
    ...CONVERSATION_CONTEXT_STATE_JSON_META,
    validate: isConversationContextState,
  });
}

export function stringifyConversationMessages(messages: TyrumUIMessage[]): string {
  return stringifyPersistedJson({
    value: messages,
    ...CONVERSATION_MESSAGES_JSON_META,
    validate: isChatMessageArray,
  });
}

export function buildConversationListWhereClause(input: {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  connectorKey?: string;
  archived?: boolean;
  cursor?: { updated_at: string; conversation_id: string };
}): { where: string[]; params: unknown[] } {
  const where = ["s.tenant_id = ?", "s.agent_id = ?", "s.workspace_id = ?"];
  const params: unknown[] = [input.tenantId, input.agentId, input.workspaceId];
  if (input.connectorKey) {
    where.push("ca.connector_key = ?");
    params.push(input.connectorKey);
  }
  if (input.archived === true) {
    where.push("s.archived_at IS NOT NULL");
  } else {
    where.push("s.archived_at IS NULL");
  }
  if (input.cursor) {
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.conversation_id < ?))");
    params.push(input.cursor.updated_at, input.cursor.updated_at, input.cursor.conversation_id);
  }
  return { where, params };
}

export function createConversationContextStateForMessages(
  recentMessages: readonly TyrumUIMessage[],
  updatedAt: string,
  current?: ConversationState,
): ConversationState {
  const nextRecentMessageIds = (() => {
    if (current?.compacted_through_message_id) {
      const compactedIndex = recentMessages.findIndex(
        (message) => message.id === current.compacted_through_message_id,
      );
      if (compactedIndex >= 0) {
        return recentMessages.slice(compactedIndex + 1).map((message) => message.id);
      }
    }
    if (current?.recent_message_ids.length) {
      const recentIdSet = new Set(current.recent_message_ids);
      const lastKnownIndex = recentMessages.findIndex((message) => recentIdSet.has(message.id));
      if (lastKnownIndex >= 0) {
        return recentMessages.slice(lastKnownIndex).map((message) => message.id);
      }
    }
    return recentMessages.map((message) => message.id);
  })();
  return {
    ...(current ?? createEmptyConversationContextState(updatedAt)),
    recent_message_ids: nextRecentMessageIds,
    updated_at: updatedAt,
  };
}
