import type { SqlDb } from "../../statestore/types.js";
import { escapeLikePattern } from "../../utils/sql-like.js";
import { encodeTurnKeyPart } from "./turn-key.js";

export async function resolveStoredKeyLaneByChannelThread(
  db: SqlDb,
  input: { agentId: string; channel: string; threadId: string },
): Promise<{ key: string; lane: string } | undefined> {
  const safeAgentId = escapeLikePattern(encodeTurnKeyPart(input.agentId.trim()));
  const safeChannel = escapeLikePattern(encodeTurnKeyPart(input.channel.trim()));
  const safeThread = escapeLikePattern(encodeTurnKeyPart(input.threadId.trim()));
  const keyPattern = `agent:${safeAgentId}:${safeChannel}:%:%:${safeThread}`;

  const runRow = await db.get<{ key: string; lane: string }>(
    `SELECT conversation_key AS key, lane
     FROM turns
     WHERE conversation_key LIKE ? ESCAPE '\\'
     ORDER BY created_at DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (runRow?.key) return runRow;

  const queueRow = await db.get<{ key: string; lane: string }>(
    `SELECT conversation_key AS key, lane
     FROM conversation_queue_overrides
     WHERE conversation_key LIKE ? ESCAPE '\\'
     ORDER BY updated_at_ms DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (queueRow?.key) return queueRow;

  const sendRow = await db.get<{ key: string }>(
    `SELECT conversation_key AS key
     FROM conversation_send_policy_overrides
     WHERE conversation_key LIKE ? ESCAPE '\\'
     ORDER BY updated_at_ms DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (sendRow?.key) return { key: sendRow.key, lane: "main" };

  return undefined;
}
