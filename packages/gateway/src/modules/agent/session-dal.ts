import type { SqlDb } from "../../statestore/types.js";
import { resolveAgentId } from "./agent-scope.js";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionRow {
  session_id: string;
  agent_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns: SessionMessage[];
  compacted_summary: string;
  compaction_count: number;
  created_at: string;
  updated_at: string;
}

interface RawSessionRow {
  session_id: string;
  agent_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_json: string;
  compacted_summary: string | null;
  compaction_count: number | null;
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
    session_id: raw.session_id,
    agent_id: raw.agent_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    summary: raw.summary,
    turns: parseTurns(raw.turns_json),
    compacted_summary: raw.compacted_summary ?? "",
    compaction_count: raw.compaction_count ?? 0,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function formatSessionId(channel: string, threadId: string): string {
  const channelPart = encodeURIComponent(channel);
  const threadPart = encodeURIComponent(threadId);
  return `${channelPart}:${threadPart}`;
}

export function formatLegacySessionId(channel: string, threadId: string): string {
  return `${channel}:${threadId}`;
}

export class SessionDal {
  constructor(private readonly db: SqlDb) {}

  async getOrCreate(channel: string, threadId: string, agentId?: string): Promise<SessionRow> {
    const resolvedAgentId = resolveAgentId(agentId);
    const sessionId = formatSessionId(channel, threadId);
    const existing = await this.getById(sessionId, resolvedAgentId);
    if (existing) {
      return existing;
    }

    const legacyId = formatLegacySessionId(channel, threadId);
    if (legacyId !== sessionId) {
      const legacy = await this.getById(legacyId, resolvedAgentId);
      if (legacy) {
        const conflict = await this.getById(sessionId, resolvedAgentId);
        if (!conflict) {
          const nowIso = new Date().toISOString();
          await this.db.run(
            "UPDATE sessions SET session_id = ?, updated_at = ? WHERE session_id = ? AND agent_id = ?",
            [sessionId, nowIso, legacyId, resolvedAgentId],
          );
          const migrated = await this.getById(sessionId, resolvedAgentId);
          if (migrated) {
            return migrated;
          }
        }
        return legacy;
      }
    }

    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO sessions (session_id, agent_id, channel, thread_id, summary, turns_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
      [sessionId, resolvedAgentId, channel, threadId, nowIso, nowIso],
    );

    const created = await this.getById(sessionId, resolvedAgentId);
    if (!created) {
      throw new Error(`failed to create session '${sessionId}'`);
    }
    return created;
  }

  async getById(sessionId: string, agentId?: string): Promise<SessionRow | undefined> {
    const resolvedAgentId = resolveAgentId(agentId);
    const row = await this.db.get<RawSessionRow>(
      "SELECT * FROM sessions WHERE session_id = ? AND agent_id = ?",
      [sessionId, resolvedAgentId],
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
    const resolvedAgentId = resolveAgentId(agentId);
    const session = await this.getById(sessionId, resolvedAgentId);
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
    const bounded = turns.slice(-maxMessages);

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, updated_at = ?
       WHERE session_id = ? AND agent_id = ?`,
      [JSON.stringify(bounded), nowIso, sessionId, resolvedAgentId],
    );

    const updated = await this.getById(sessionId, resolvedAgentId);
    if (!updated) {
      throw new Error(`session '${sessionId}' missing after update`);
    }
    return updated;
  }

  async updateSummary(sessionId: string, summary: string, agentId?: string): Promise<void> {
    const resolvedAgentId = resolveAgentId(agentId);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET summary = ?, updated_at = ?
       WHERE session_id = ? AND agent_id = ?`,
      [summary, nowIso, sessionId, resolvedAgentId],
    );
  }

  async updateCompaction(
    sessionId: string,
    compactedSummary: string,
    remainingTurns: SessionMessage[],
    agentId?: string,
  ): Promise<void> {
    const resolvedAgentId = resolveAgentId(agentId);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET compacted_summary = ?, turns_json = ?, compaction_count = compaction_count + 1, updated_at = ?
       WHERE session_id = ? AND agent_id = ?`,
      [compactedSummary, JSON.stringify(remainingTurns), nowIso, sessionId, resolvedAgentId],
    );
  }

  async deleteExpired(ttlDays: number): Promise<number> {
    const safeTtl = Math.max(1, ttlDays);
    const threshold = new Date(Date.now() - safeTtl * 24 * 60 * 60 * 1000).toISOString();
    const deleteSql =
      this.db.kind === "sqlite"
        ? `DELETE FROM sessions
           WHERE datetime(updated_at) < datetime(?)`
        : `DELETE FROM sessions
           WHERE updated_at < ?`;
    const result = await this.db.run(deleteSql, [threshold]);
    return result.changes;
  }
}
