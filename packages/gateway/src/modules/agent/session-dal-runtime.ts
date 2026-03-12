import type { SessionTranscriptItem } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { stringifyPersistedJson } from "../observability/persisted-json.js";
import { SESSION_TURNS_JSON_META, isSessionTranscriptArray } from "./session-dal-helpers.js";

function transcriptDisplayOrderTimestamp(item: SessionTranscriptItem): string {
  return item.created_at;
}

function transcriptActivityTimestamp(item: SessionTranscriptItem): string {
  return item.kind === "text" ? item.created_at : item.updated_at;
}

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
  } catch (error) {
    void error;
    return undefined;
  }
}

export function latestTranscriptTimestamp(
  transcript: readonly SessionTranscriptItem[],
): string | undefined {
  let latest: string | undefined;
  for (const item of transcript) {
    const itemAt = transcriptActivityTimestamp(item);
    if (!latest || itemAt.localeCompare(latest) > 0) {
      latest = itemAt;
    }
  }
  return latest;
}

export function sortSessionTranscript(
  transcript: readonly SessionTranscriptItem[],
): SessionTranscriptItem[] {
  return transcript.toSorted((left, right) => {
    const leftAt = transcriptDisplayOrderTimestamp(left);
    const rightAt = transcriptDisplayOrderTimestamp(right);
    if (leftAt === rightAt) return 0;
    return leftAt.localeCompare(rightAt);
  });
}

export function stringifySessionTranscript(transcript: SessionTranscriptItem[]): string {
  return stringifyPersistedJson({
    value: transcript,
    ...SESSION_TURNS_JSON_META,
    validate: isSessionTranscriptArray,
  });
}

export function buildSessionListWhereClause(input: {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  connectorKey?: string;
  cursor?: { updated_at: string; session_id: string };
}): { where: string[]; params: unknown[] } {
  const where = ["s.tenant_id = ?", "s.agent_id = ?", "s.workspace_id = ?"];
  const params: unknown[] = [input.tenantId, input.agentId, input.workspaceId];
  if (input.connectorKey) {
    where.push("ca.connector_key = ?");
    params.push(input.connectorKey);
  }
  if (input.cursor) {
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.session_id < ?))");
    params.push(input.cursor.updated_at, input.cursor.updated_at, input.cursor.session_id);
  }
  return { where, params };
}

export async function loadOutboxReplyText(
  db: SqlDb,
  input: { tenantId: string; inboxId: number },
): Promise<string | undefined> {
  const rows = await db.all<{ text: string }>(
    "SELECT text FROM channel_outbox WHERE tenant_id = ? AND inbox_id = ? ORDER BY chunk_index ASC, outbox_id ASC",
    [input.tenantId, input.inboxId],
  );
  return rows.length > 0 ? rows.map((row) => row.text).join("") : undefined;
}
