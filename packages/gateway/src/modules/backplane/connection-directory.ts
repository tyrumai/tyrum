import type { ClientCapability } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export interface ConnectionDirectoryRow {
  connection_id: string;
  edge_id: string;
  capabilities: ClientCapability[];
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface RawConnectionDirectoryRow {
  connection_id: string;
  edge_id: string;
  capabilities_json: string;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

function toRow(raw: RawConnectionDirectoryRow): ConnectionDirectoryRow {
  let capabilities: ClientCapability[] = [];
  try {
    const parsed = JSON.parse(raw.capabilities_json) as unknown;
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((v): v is ClientCapability => typeof v === "string") as ClientCapability[];
    }
  } catch {
    // leave empty
  }
  return {
    connection_id: raw.connection_id,
    edge_id: raw.edge_id,
    capabilities,
    connected_at_ms: raw.connected_at_ms,
    last_seen_at_ms: raw.last_seen_at_ms,
    expires_at_ms: raw.expires_at_ms,
  };
}

export class ConnectionDirectoryDal {
  constructor(private readonly db: SqlDb) {}

  async upsertConnection(params: {
    connectionId: string;
    edgeId: string;
    capabilities: readonly ClientCapability[];
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const expiresAtMs = params.nowMs + params.ttlMs;
    await this.db.run(
      `INSERT INTO connection_directory (
         connection_id,
         edge_id,
         capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         edge_id = excluded.edge_id,
         capabilities_json = excluded.capabilities_json,
         last_seen_at_ms = excluded.last_seen_at_ms,
         expires_at_ms = excluded.expires_at_ms`,
      [
        params.connectionId,
        params.edgeId,
        JSON.stringify(params.capabilities ?? []),
        params.nowMs,
        params.nowMs,
        expiresAtMs,
      ],
    );
  }

  async touchConnection(params: {
    connectionId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const expiresAtMs = params.nowMs + params.ttlMs;
    await this.db.run(
      `UPDATE connection_directory
       SET last_seen_at_ms = ?, expires_at_ms = ?
       WHERE connection_id = ?`,
      [params.nowMs, expiresAtMs, params.connectionId],
    );
  }

  async removeConnection(connectionId: string): Promise<void> {
    await this.db.run(
      "DELETE FROM connection_directory WHERE connection_id = ?",
      [connectionId],
    );
  }

  async cleanupExpired(nowMs: number): Promise<number> {
    return (await this.db.run(
      "DELETE FROM connection_directory WHERE expires_at_ms <= ?",
      [nowMs],
    )).changes;
  }

  async listNonExpired(nowMs: number): Promise<ConnectionDirectoryRow[]> {
    const rows = await this.db.all<RawConnectionDirectoryRow>(
      `SELECT *
       FROM connection_directory
       WHERE expires_at_ms > ?
       ORDER BY last_seen_at_ms DESC`,
      [nowMs],
    );
    return rows.map(toRow);
  }

  async listConnectionsForCapability(
    capability: ClientCapability,
    nowMs: number,
  ): Promise<ConnectionDirectoryRow[]> {
    const rows = await this.listNonExpired(nowMs);
    return rows.filter((r) => r.capabilities.includes(capability));
  }
}

