import type { SqlDb } from "../../statestore/types.js";

export class DedupeDal {
  constructor(private readonly db: SqlDb) {}

  /** Check if a message has already been processed. Returns true if duplicate. */
  async isDuplicate(messageId: string, channel: string): Promise<boolean> {
    const existing = await this.db.get<{ message_id: string }>(
      "SELECT message_id FROM inbound_dedupe WHERE message_id = ? AND channel = ?",
      [messageId, channel],
    );
    return existing !== undefined;
  }

  /** Record a message as processed. */
  async record(
    messageId: string,
    channel: string,
    ttlMs: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await this.db.run(
      "INSERT OR IGNORE INTO inbound_dedupe (message_id, channel, expires_at) VALUES (?, ?, ?)",
      [messageId, channel, expiresAt],
    );
  }

  /** Clean up expired dedupe records. */
  async cleanup(): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      "DELETE FROM inbound_dedupe WHERE expires_at <= ?",
      [nowIso],
    );
    return result.changes;
  }
}
