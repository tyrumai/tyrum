import type { SqlDb } from "../../statestore/types.js";

export type PresenceRole = "gateway" | "client" | "node";

export interface PresenceRow {
  instance_id: string;
  role: PresenceRole;
  connection_id: string | null;
  host: string | null;
  ip: string | null;
  version: string | null;
  mode: string | null;
  last_input_seconds: number | null;
  metadata: unknown;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface RawPresenceRow {
  instance_id: string;
  role: string;
  connection_id: string | null;
  host: string | null;
  ip: string | null;
  version: string | null;
  mode: string | null;
  last_input_seconds: number | null;
  metadata_json: string;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

function parseMetadata(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function toPresenceRow(raw: RawPresenceRow): PresenceRow {
  const role = raw.role === "gateway" || raw.role === "node" ? raw.role : "client";
  return {
    instance_id: raw.instance_id,
    role,
    connection_id: raw.connection_id,
    host: raw.host,
    ip: raw.ip,
    version: raw.version,
    mode: raw.mode,
    last_input_seconds: raw.last_input_seconds,
    metadata: parseMetadata(raw.metadata_json),
    connected_at_ms: raw.connected_at_ms,
    last_seen_at_ms: raw.last_seen_at_ms,
    expires_at_ms: raw.expires_at_ms,
  };
}

export class PresenceDal {
  constructor(private readonly db: SqlDb) {}

  async upsert(params: {
    instanceId: string;
    role: PresenceRole;
    connectionId?: string | null;
    host?: string | null;
    ip?: string | null;
    version?: string | null;
    mode?: string | null;
    lastInputSeconds?: number | null;
    metadata?: unknown;
    nowMs: number;
    ttlMs: number;
  }): Promise<PresenceRow> {
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const metadataJson = JSON.stringify(params.metadata ?? {});
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO presence_entries (
         instance_id,
         role,
         connection_id,
         host,
         ip,
         version,
         mode,
         last_input_seconds,
         metadata_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         role = excluded.role,
         connection_id = excluded.connection_id,
         host = COALESCE(excluded.host, presence_entries.host),
         ip = COALESCE(excluded.ip, presence_entries.ip),
         version = COALESCE(excluded.version, presence_entries.version),
         mode = COALESCE(excluded.mode, presence_entries.mode),
         last_input_seconds = COALESCE(excluded.last_input_seconds, presence_entries.last_input_seconds),
         metadata_json = excluded.metadata_json,
         connected_at_ms = excluded.connected_at_ms,
         last_seen_at_ms = excluded.last_seen_at_ms,
         expires_at_ms = excluded.expires_at_ms,
         updated_at = excluded.updated_at`,
      [
        params.instanceId,
        params.role,
        params.connectionId ?? null,
        params.host ?? null,
        params.ip ?? null,
        params.version ?? null,
        params.mode ?? null,
        params.lastInputSeconds ?? null,
        metadataJson,
        params.nowMs,
        params.nowMs,
        expiresAtMs,
        nowIso,
      ],
    );

    const row = await this.getByInstanceId(params.instanceId);
    if (!row) {
      throw new Error(`presence upsert failed for ${params.instanceId}`);
    }
    return row;
  }

  async touch(params: { instanceId: string; nowMs: number; ttlMs: number }): Promise<void> {
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE presence_entries
       SET last_seen_at_ms = ?, expires_at_ms = ?, updated_at = ?
       WHERE instance_id = ?`,
      [params.nowMs, expiresAtMs, nowIso, params.instanceId],
    );
  }

  async markDisconnected(params: {
    instanceId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE presence_entries
       SET connection_id = NULL, last_seen_at_ms = ?, expires_at_ms = ?, updated_at = ?
       WHERE instance_id = ?`,
      [params.nowMs, expiresAtMs, nowIso, params.instanceId],
    );
  }

  async getByInstanceId(instanceId: string): Promise<PresenceRow | undefined> {
    const row = await this.db.get<RawPresenceRow>(
      `SELECT *
       FROM presence_entries
       WHERE instance_id = ?`,
      [instanceId],
    );
    return row ? toPresenceRow(row) : undefined;
  }

  async listNonExpired(nowMs: number, limit = 200): Promise<PresenceRow[]> {
    const rows = await this.db.all<RawPresenceRow>(
      `SELECT *
       FROM presence_entries
       WHERE expires_at_ms > ?
       ORDER BY last_seen_at_ms DESC
       LIMIT ?`,
      [nowMs, Math.max(1, Math.min(1000, limit))],
    );
    return rows.map(toPresenceRow);
  }

  async pruneExpired(nowMs: number): Promise<string[]> {
    const expired = await this.db.all<{ instance_id: string }>(
      `SELECT instance_id
       FROM presence_entries
       WHERE expires_at_ms <= ?`,
      [nowMs],
    );
    await this.db.run(
      `DELETE FROM presence_entries
       WHERE expires_at_ms <= ?`,
      [nowMs],
    );
    return expired.map((r) => r.instance_id);
  }

  async enforceCap(maxEntries: number): Promise<string[]> {
    const cap = Math.max(1, Math.min(10_000, Math.floor(maxEntries)));
    const rows = await this.db.all<{ instance_id: string }>(
      `SELECT instance_id
       FROM presence_entries
       ORDER BY last_seen_at_ms DESC`,
    );
    if (rows.length <= cap) return [];
    const toRemove = rows.slice(cap).map((r) => r.instance_id);
    for (const id of toRemove) {
      await this.db.run("DELETE FROM presence_entries WHERE instance_id = ?", [id]);
    }
    return toRemove;
  }
}
