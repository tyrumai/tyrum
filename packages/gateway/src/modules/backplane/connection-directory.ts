import type Database from "better-sqlite3";
import type { ClientCapability } from "@tyrum/schemas";

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
  constructor(private readonly db: Database.Database) {}

  upsertConnection(params: {
    connectionId: string;
    edgeId: string;
    capabilities: readonly ClientCapability[];
    nowMs: number;
    ttlMs: number;
  }): void {
    const expiresAtMs = params.nowMs + params.ttlMs;
    this.db
      .prepare(
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
      )
      .run(
        params.connectionId,
        params.edgeId,
        JSON.stringify(params.capabilities ?? []),
        params.nowMs,
        params.nowMs,
        expiresAtMs,
      );
  }

  touchConnection(params: {
    connectionId: string;
    nowMs: number;
    ttlMs: number;
  }): void {
    const expiresAtMs = params.nowMs + params.ttlMs;
    this.db
      .prepare(
        `UPDATE connection_directory
         SET last_seen_at_ms = ?, expires_at_ms = ?
         WHERE connection_id = ?`,
      )
      .run(params.nowMs, expiresAtMs, params.connectionId);
  }

  removeConnection(connectionId: string): void {
    this.db
      .prepare("DELETE FROM connection_directory WHERE connection_id = ?")
      .run(connectionId);
  }

  cleanupExpired(nowMs: number): number {
    const result = this.db
      .prepare("DELETE FROM connection_directory WHERE expires_at_ms <= ?")
      .run(nowMs);
    return result.changes;
  }

  listNonExpired(nowMs: number): ConnectionDirectoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM connection_directory
         WHERE expires_at_ms > ?
         ORDER BY last_seen_at_ms DESC`,
      )
      .all(nowMs) as RawConnectionDirectoryRow[];
    return rows.map(toRow);
  }

  listConnectionsForCapability(
    capability: ClientCapability,
    nowMs: number,
  ): ConnectionDirectoryRow[] {
    const rows = this.listNonExpired(nowMs);
    return rows.filter((r) => r.capabilities.includes(capability));
  }
}

