import type Database from "better-sqlite3";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionRow {
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns: SessionMessage[];
  created_at: string;
  updated_at: string;
}

interface RawSessionRow {
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_json: string;
  created_at: string;
  updated_at: string;
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
  return {
    session_id: raw.session_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    summary: raw.summary,
    turns: parseTurns(raw.turns_json),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
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
  constructor(private readonly db: Database.Database) {}

  getOrCreate(channel: string, threadId: string): SessionRow {
    const sessionId = formatSessionId(channel, threadId);
    const existing = this.getById(sessionId);
    if (existing) {
      return existing;
    }

    const legacyId = formatLegacySessionId(channel, threadId);
    if (legacyId !== sessionId) {
      const legacy = this.getById(legacyId);
      if (legacy) {
        const conflict = this.getById(sessionId);
        if (!conflict) {
          this.db
            .prepare(
              "UPDATE sessions SET session_id = ?, updated_at = datetime('now') WHERE session_id = ?",
            )
            .run(sessionId, legacyId);
          const migrated = this.getById(sessionId);
          if (migrated) {
            return migrated;
          }
        }
        return legacy;
      }
    }

    this.db
      .prepare(
        `INSERT INTO sessions (session_id, channel, thread_id, summary, turns_json)
         VALUES (?, ?, ?, '', '[]')`,
      )
      .run(sessionId, channel, threadId);

    const created = this.getById(sessionId);
    if (!created) {
      throw new Error(`failed to create session '${sessionId}'`);
    }
    return created;
  }

  getById(sessionId: string): SessionRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as RawSessionRow | undefined;
    if (!row) {
      return undefined;
    }
    return toSessionRow(row);
  }

  appendTurn(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    maxTurns: number,
    timestamp: string,
  ): SessionRow {
    const session = this.getById(sessionId);
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

    this.db
      .prepare(
        `UPDATE sessions
         SET turns_json = ?, updated_at = datetime('now')
         WHERE session_id = ?`,
      )
      .run(JSON.stringify(bounded), sessionId);

    const updated = this.getById(sessionId);
    if (!updated) {
      throw new Error(`session '${sessionId}' missing after update`);
    }
    return updated;
  }

  updateSummary(sessionId: string, summary: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET summary = ?, updated_at = datetime('now')
         WHERE session_id = ?`,
      )
      .run(summary, sessionId);
  }

  deleteExpired(ttlDays: number): number {
    const safeTtl = Math.max(1, ttlDays);
    const result = this.db
      .prepare(
        `DELETE FROM sessions
         WHERE datetime(updated_at) < datetime('now', '-' || ? || ' days')`,
      )
      .run(String(safeTtl));

    return result.changes;
  }
}
