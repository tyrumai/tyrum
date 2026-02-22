import type { SqlDb } from "../../statestore/types.js";

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
  } catch {
    return [];
  }
}

function toSessionRow(raw: RawSessionRow): SessionRow {
  const createdAt =
    raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at;
  const updatedAt =
    raw.updated_at instanceof Date ? raw.updated_at.toISOString() : raw.updated_at;
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

  const prevLines =
    previousSummary.trim().length > 0 ? previousSummary.trim().split("\n") : [];

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
    const summary = dropped.length > 0
      ? compactSessionSummary(session.summary, dropped)
      : session.summary;

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

  async updateSummary(sessionId: string, summary: string, agentId?: string): Promise<void> {
    const normalizedAgentId = normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET summary = ?, updated_at = ?
       WHERE agent_id = ? AND session_id = ?`,
      [summary, nowIso, normalizedAgentId, sessionId],
    );
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
}
