import type { TyrumUIMessage } from "@tyrum/schemas";
import { stringifyPersistedJson } from "../observability/persisted-json.js";
import {
  createEmptySessionContextState,
  type SessionContextState,
  SESSION_CONTEXT_STATE_JSON_META,
  SESSION_MESSAGES_JSON_META,
  isChatMessageArray,
  isSessionContextState,
} from "./session-dal-helpers.js";

export function encodeSessionCursor(input: { updated_at: string; session_id: string }): string {
  return Buffer.from(
    JSON.stringify({ updated_at: input.updated_at, session_id: input.session_id }),
    "utf-8",
  ).toString("base64url");
}

export function decodeSessionCursor(
  cursor: string,
): { updated_at: string; session_id: string } | undefined {
  const trimmed = cursor.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const { updated_at: updatedAt, session_id: sessionId } = parsed as Record<string, unknown>;
    return typeof updatedAt === "string" &&
      updatedAt.trim().length > 0 &&
      typeof sessionId === "string" &&
      sessionId.trim().length > 0
      ? { updated_at: updatedAt, session_id: sessionId }
      : undefined;
  } catch {
    // Intentional: invalid cursors should behave the same as an omitted cursor.
    return undefined;
  }
}

export function stringifySessionContextState(state: SessionContextState): string {
  return stringifyPersistedJson({
    value: state,
    ...SESSION_CONTEXT_STATE_JSON_META,
    validate: isSessionContextState,
  });
}

export function stringifySessionMessages(messages: TyrumUIMessage[]): string {
  return stringifyPersistedJson({
    value: messages,
    ...SESSION_MESSAGES_JSON_META,
    validate: isChatMessageArray,
  });
}

export function buildSessionListWhereClause(input: {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  connectorKey?: string;
  archived?: boolean;
  cursor?: { updated_at: string; session_id: string };
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
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.session_id < ?))");
    params.push(input.cursor.updated_at, input.cursor.updated_at, input.cursor.session_id);
  }
  return { where, params };
}

export function createSessionContextStateForMessages(
  recentMessages: readonly TyrumUIMessage[],
  updatedAt: string,
  current?: SessionContextState,
): SessionContextState {
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
    ...(current ?? createEmptySessionContextState(updatedAt)),
    recent_message_ids: nextRecentMessageIds,
    updated_at: updatedAt,
  };
}
