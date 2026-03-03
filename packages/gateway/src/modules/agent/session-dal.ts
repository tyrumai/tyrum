import type { SqlDb } from "../../statestore/types.js";
import { Logger } from "../observability/logger.js";

const logger = new Logger({ base: { module: "agent.session_dal" } });
let warnedTurnsJsonParse = false;

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionRow {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns: SessionMessage[];
  created_at: string;
  updated_at: string;
}

export interface SessionListRow {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_count: number;
  last_turn: { role: "user" | "assistant"; content: string } | null;
  created_at: string;
  updated_at: string;
}

interface RawSessionRow {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawSessionListRow {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_count: number;
  last_turn_role: "user" | "assistant" | null;
  last_turn_content: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseTurns(raw: string): SessionMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const safe: SessionMessage[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        ((entry as Record<string, unknown>)["role"] === "user" ||
          (entry as Record<string, unknown>)["role"] === "assistant") &&
        typeof (entry as Record<string, unknown>)["content"] === "string" &&
        typeof (entry as Record<string, unknown>)["timestamp"] === "string"
      ) {
        safe.push({
          role: (entry as Record<string, unknown>)["role"] as "user" | "assistant",
          content: (entry as Record<string, unknown>)["content"] as string,
          timestamp: (entry as Record<string, unknown>)["timestamp"] as string,
        });
      }
    }
    return safe;
  } catch (err) {
    if (!warnedTurnsJsonParse) {
      warnedTurnsJsonParse = true;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("sessions.turns_json_parse_failed", { error: message });
    }
    return [];
  }
}

function toSessionRow(raw: RawSessionRow): SessionRow {
  const createdAt = raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at;
  const updatedAt = raw.updated_at instanceof Date ? raw.updated_at.toISOString() : raw.updated_at;
  return {
    agent_id: raw.agent_id,
    session_id: raw.session_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    summary: raw.summary,
    turns: parseTurns(raw.turns_json),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function toSessionListRow(raw: RawSessionListRow): SessionListRow {
  const createdAt = raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at;
  const updatedAt = raw.updated_at instanceof Date ? raw.updated_at.toISOString() : raw.updated_at;

  const turnsCount = Number.isFinite(raw.turns_count) ? raw.turns_count : 0;
  const role = raw.last_turn_role;
  const content = raw.last_turn_content;
  const lastTurn =
    (role === "user" || role === "assistant") && typeof content === "string"
      ? { role, content }
      : null;

  return {
    agent_id: raw.agent_id,
    session_id: raw.session_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    summary: raw.summary,
    turns_count: turnsCount,
    last_turn: lastTurn,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function normalizeAgentId(agentId: string | undefined): string {
  const trimmed = agentId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "default";
}

function trimTo(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function compactSessionSummary(
  previousSummary: string,
  droppedTurns: readonly SessionMessage[],
  opts?: { maxLines?: number; maxChars?: number; maxLineChars?: number },
): string {
  const maxLines = Math.max(10, opts?.maxLines ?? 200);
  const maxChars = Math.max(200, opts?.maxChars ?? 6000);
  const maxLineChars = Math.max(40, opts?.maxLineChars ?? 240);

  const prevLines = previousSummary.trim().length > 0 ? previousSummary.trim().split("\n") : [];

  const newLines = droppedTurns.map((turn) => {
    const role = turn.role === "assistant" ? "A" : "U";
    const content = trimTo(turn.content.trim(), maxLineChars);
    return `${role} ${turn.timestamp}: ${content}`;
  });

  let lines = [...prevLines, ...newLines];
  if (lines.length > maxLines) {
    lines = lines.slice(lines.length - maxLines);
  }

  while (lines.length > 1 && lines.join("\n").length > maxChars) {
    lines = lines.slice(1);
  }

  return lines.join("\n");
}

export function formatSessionId(channel: string, threadId: string, agentId?: string): string {
  const normalizedAgentId = normalizeAgentId(agentId);
  const channelPart = encodeURIComponent(channel);
  const threadPart = encodeURIComponent(threadId);
  if (normalizedAgentId === "default") {
    return `${channelPart}:${threadPart}`;
  }
  const agentPart = encodeURIComponent(normalizedAgentId);
  return `agent:${agentPart}:${channelPart}:${threadPart}`;
}

export function formatLegacySessionId(channel: string, threadId: string): string {
  return `${channel}:${threadId}`;
}

export class SessionDal {
  constructor(private readonly db: SqlDb) {}

  private static encodeCursor(input: { updated_at: string; session_id: string }): string {
    const payload = { updated_at: input.updated_at, session_id: input.session_id };
    return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  }

  private static decodeCursor(
    cursor: string,
  ): { updated_at: string; session_id: string } | undefined {
    const trimmed = cursor.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object") return undefined;
      const updatedAt = (parsed as Record<string, unknown>)["updated_at"];
      const sessionId = (parsed as Record<string, unknown>)["session_id"];
      if (typeof updatedAt !== "string" || updatedAt.trim().length === 0) return undefined;
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) return undefined;
      return { updated_at: updatedAt, session_id: sessionId };
    } catch {
      // Intentional: treat any cursor decode failures as an invalid cursor.
      return undefined;
    }
  }

  async list(input: {
    agentId?: string;
    channel?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ sessions: SessionListRow[]; nextCursor: string | null }> {
    const normalizedAgentId = normalizeAgentId(input.agentId);
    const channel = input.channel?.trim();
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
    const cursor = input.cursor ? SessionDal.decodeCursor(input.cursor) : undefined;
    if (input.cursor && !cursor) {
      throw new Error("invalid cursor");
    }

    const where: string[] = ["agent_id = ?"];
    const params: unknown[] = [normalizedAgentId];

    if (channel && channel.length > 0) {
      where.push("channel = ?");
      params.push(channel);
    }

    if (cursor) {
      where.push("(updated_at < ? OR (updated_at = ? AND session_id < ?))");
      params.push(cursor.updated_at, cursor.updated_at, cursor.session_id);
    }

    const listSql =
      this.db.kind === "sqlite"
        ? `SELECT agent_id,
	             session_id,
	             channel,
             thread_id,
             summary,
             created_at,
             updated_at,
             CASE
               WHEN json_valid(turns_json)
                 THEN json_array_length(turns_json)
               ELSE 0
             END AS turns_count,
             CASE
               WHEN json_valid(turns_json)
                 THEN json_extract(turns_json, '$[#-1].role')
               ELSE NULL
             END AS last_turn_role,
             CASE
               WHEN json_valid(turns_json)
                 THEN json_extract(turns_json, '$[#-1].content')
               ELSE NULL
             END AS last_turn_content
	           FROM sessions
	           WHERE ${where.join(" AND ")}
	           ORDER BY updated_at DESC, session_id DESC
	           LIMIT ?`
        : `SELECT agent_id,
	             session_id,
	             channel,
	             thread_id,
	             summary,
	             created_at,
	             updated_at,
	             CASE
	               WHEN jsonb_typeof(turns) = 'array' THEN jsonb_array_length(turns)
	               ELSE 0
	             END AS turns_count,
	             (turns -> -1 ->> 'role') AS last_turn_role,
	             (turns -> -1 ->> 'content') AS last_turn_content
	           FROM (
	             SELECT agent_id,
               session_id,
               channel,
               thread_id,
               summary,
               created_at,
               updated_at,
               CASE
                 WHEN pg_input_is_valid(turns_json, 'jsonb') THEN turns_json::jsonb
                 ELSE '[]'::jsonb
               END AS turns
             FROM sessions
             WHERE ${where.join(" AND ")}
           ) sessions_with_turns
           ORDER BY updated_at DESC, session_id DESC
           LIMIT ?`;

    const rows = await this.db.all<RawSessionListRow>(listSql, [...params, limit + 1]);

    const selected = rows.slice(0, limit).map(toSessionListRow);
    const hasMore = rows.length > limit;
    const last = selected.at(-1);

    return {
      sessions: selected,
      nextCursor:
        hasMore && last
          ? SessionDal.encodeCursor({ updated_at: last.updated_at, session_id: last.session_id })
          : null,
    };
  }

  async getOrCreate(channel: string, threadId: string, agentId?: string): Promise<SessionRow> {
    const normalizedAgentId = normalizeAgentId(agentId);
    const sessionId = formatSessionId(channel, threadId, normalizedAgentId);
    const existing = await this.getById(sessionId, normalizedAgentId);
    if (existing) {
      return existing;
    }

    if (normalizedAgentId === "default") {
      const legacyId = formatLegacySessionId(channel, threadId);
      if (legacyId !== sessionId) {
        const legacy = await this.getById(legacyId, normalizedAgentId);
        if (legacy) {
          const conflict = await this.getById(sessionId, normalizedAgentId);
          if (!conflict) {
            const nowIso = new Date().toISOString();
            await this.db.run(
              "UPDATE sessions SET session_id = ?, updated_at = ? WHERE agent_id = ? AND session_id = ?",
              [sessionId, nowIso, normalizedAgentId, legacyId],
            );
            const migrated = await this.getById(sessionId, normalizedAgentId);
            if (migrated) {
              return migrated;
            }
          }
          return legacy;
        }
      }
    }

    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
      [normalizedAgentId, sessionId, channel, threadId, nowIso, nowIso],
    );

    const created = await this.getById(sessionId, normalizedAgentId);
    if (!created) {
      throw new Error(`failed to create session '${sessionId}'`);
    }
    return created;
  }

  async getById(sessionId: string, agentId?: string): Promise<SessionRow | undefined> {
    const row = await this.db.get<RawSessionRow>(
      "SELECT * FROM sessions WHERE agent_id = ? AND session_id = ?",
      [normalizeAgentId(agentId), sessionId],
    );
    if (!row) {
      return undefined;
    }
    return toSessionRow(row);
  }

  async appendTurn(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    maxTurns: number,
    timestamp: string,
    agentId?: string,
  ): Promise<SessionRow> {
    const normalizedAgentId = normalizeAgentId(agentId);
    const session = await this.getById(sessionId, normalizedAgentId);
    if (!session) {
      throw new Error(`session '${sessionId}' not found`);
    }

    const turns = session.turns.slice();
    turns.push({
      role: "user",
      content: userMessage,
      timestamp,
    });
    turns.push({
      role: "assistant",
      content: assistantMessage,
      timestamp,
    });

    const maxMessages = Math.max(1, maxTurns) * 2;
    const overflow = turns.length - maxMessages;
    const dropped = overflow > 0 ? turns.slice(0, overflow) : [];
    const bounded = turns.slice(-maxMessages);
    const summary =
      dropped.length > 0 ? compactSessionSummary(session.summary, dropped) : session.summary;

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE agent_id = ? AND session_id = ?`,
      [JSON.stringify(bounded), summary, nowIso, normalizedAgentId, sessionId],
    );

    const updated = await this.getById(sessionId, normalizedAgentId);
    if (!updated) {
      throw new Error(`session '${sessionId}' missing after update`);
    }
    return updated;
  }

  async deleteExpired(ttlDays: number, agentId?: string): Promise<number> {
    const safeTtl = Math.max(1, ttlDays);
    const threshold = new Date(Date.now() - safeTtl * 24 * 60 * 60 * 1000).toISOString();
    const normalizedAgentId = agentId === undefined ? undefined : normalizeAgentId(agentId);
    const deleteSql =
      this.db.kind === "sqlite"
        ? normalizedAgentId
          ? `DELETE FROM sessions
             WHERE agent_id = ? AND datetime(updated_at) < datetime(?)`
          : `DELETE FROM sessions
             WHERE datetime(updated_at) < datetime(?)`
        : normalizedAgentId
          ? `DELETE FROM sessions
             WHERE agent_id = ? AND updated_at < ?`
          : `DELETE FROM sessions
             WHERE updated_at < ?`;
    const result = await this.db.run(
      deleteSql,
      normalizedAgentId ? [normalizedAgentId, threshold] : [threshold],
    );
    return result.changes;
  }

  async reset(sessionId: string, agentId?: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const normalizedAgentId = normalizeAgentId(agentId);
    const res = await this.db.run(
      `UPDATE sessions
       SET summary = '',
           turns_json = '[]',
           updated_at = ?
       WHERE agent_id = ? AND session_id = ?`,
      [nowIso, normalizedAgentId, sessionId],
    );
    return res.changes === 1;
  }

  async compact(input: {
    sessionId: string;
    agentId?: string;
    keepLastMessages?: number;
  }): Promise<{ droppedMessages: number; keptMessages: number }> {
    const keepLastMessages = Math.max(1, Math.floor(input.keepLastMessages ?? 8));
    const normalizedAgentId = normalizeAgentId(input.agentId);

    const session = await this.getById(input.sessionId, normalizedAgentId);
    if (!session) {
      return { droppedMessages: 0, keptMessages: 0 };
    }

    const turns = session.turns.slice();
    const droppedCount = Math.max(0, turns.length - keepLastMessages);
    if (droppedCount === 0) {
      return { droppedMessages: 0, keptMessages: turns.length };
    }

    const dropped = turns.slice(0, droppedCount);
    const kept = turns.slice(turns.length - keepLastMessages);
    const summary = compactSessionSummary(session.summary, dropped);

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE agent_id = ? AND session_id = ?`,
      [JSON.stringify(kept), summary, nowIso, normalizedAgentId, input.sessionId],
    );

    return { droppedMessages: droppedCount, keptMessages: kept.length };
  }
}
