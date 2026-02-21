/**
 * Presence data access layer.
 *
 * Presence is best-effort and intentionally ephemeral. Rows are keyed by
 * stable `instance_id` (device identity) and refreshed via connect + beacons.
 */

import type { PresenceEntry } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

interface RawPresenceRow {
  instance_id: string;
  role: string;
  host: string | null;
  ip: string | null;
  version: string | null;
  mode: string;
  last_seen_at: string | Date;
  last_input_seconds: number | null;
  reason: string;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toPresenceEntry(raw: RawPresenceRow): PresenceEntry {
  return {
    instance_id: raw.instance_id,
    role: raw.role as PresenceEntry["role"],
    host: raw.host ?? undefined,
    ip: raw.ip ?? undefined,
    version: raw.version ?? undefined,
    mode: raw.mode as PresenceEntry["mode"],
    last_seen_at: normalizeTime(raw.last_seen_at),
    last_input_seconds: raw.last_input_seconds ?? undefined,
    reason: raw.reason as PresenceEntry["reason"],
  };
}

export class PresenceDal {
  constructor(private readonly db: SqlDb) {}

  async get(instanceId: string): Promise<PresenceEntry | undefined> {
    const row = await this.db.get<RawPresenceRow>(
      "SELECT * FROM presence_entries WHERE instance_id = ?",
      [instanceId],
    );
    return row ? toPresenceEntry(row) : undefined;
  }

  async upsert(entry: PresenceEntry): Promise<PresenceEntry> {
    const row = await this.db.get<RawPresenceRow>(
      `INSERT INTO presence_entries (
         instance_id,
         role,
         host,
         ip,
         version,
         mode,
         last_seen_at,
         last_input_seconds,
         reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         role = excluded.role,
         host = excluded.host,
         ip = excluded.ip,
         version = excluded.version,
         mode = excluded.mode,
         last_seen_at = excluded.last_seen_at,
         last_input_seconds = excluded.last_input_seconds,
         reason = excluded.reason
       RETURNING *`,
      [
        entry.instance_id,
        entry.role,
        entry.host ?? null,
        entry.ip ?? null,
        entry.version ?? null,
        entry.mode,
        entry.last_seen_at,
        entry.last_input_seconds ?? null,
        entry.reason,
      ],
    );
    if (!row) {
      throw new Error("presence upsert failed");
    }
    return toPresenceEntry(row);
  }

  async list(params?: { limit?: number }): Promise<PresenceEntry[]> {
    const limit = params?.limit ?? 250;
    const rows = await this.db.all<RawPresenceRow>(
      `SELECT *
       FROM presence_entries
       ORDER BY last_seen_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(toPresenceEntry);
  }

  async count(): Promise<number> {
    const row = await this.db.get<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM presence_entries",
    );
    const n = row ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Delete rows with `last_seen_at` older than `cutoffIso` and return pruned ids.
   */
  async pruneExpired(cutoffIso: string): Promise<string[]> {
    const rows = await this.db.all<{ instance_id: string }>(
      "DELETE FROM presence_entries WHERE last_seen_at < ? RETURNING instance_id",
      [cutoffIso],
    );
    return rows.map((r) => r.instance_id);
  }

  /**
   * Enforce a bounded table size by deleting the oldest rows beyond `maxEntries`.
   * Returns the removed instance ids.
   */
  async trimToMaxEntries(maxEntries: number): Promise<string[]> {
    const total = await this.count();
    if (total <= maxEntries) return [];
    const extra = total - maxEntries;

    const rows = await this.db.all<{ instance_id: string }>(
      `DELETE FROM presence_entries
       WHERE instance_id IN (
         SELECT instance_id
         FROM presence_entries
         ORDER BY last_seen_at ASC
         LIMIT ?
       )
       RETURNING instance_id`,
      [extra],
    );
    return rows.map((r) => r.instance_id);
  }
}

