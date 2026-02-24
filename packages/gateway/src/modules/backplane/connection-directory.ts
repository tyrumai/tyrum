import type { ClientCapability } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export interface ConnectionDirectoryRow {
  connection_id: string;
  edge_id: string;
  role: "client" | "node";
  protocol_rev: number;
  device_id: string | null;
  pubkey: string | null;
  label: string | null;
  version: string | null;
  mode: string | null;
  capabilities: ClientCapability[];
  ready_capabilities: ClientCapability[];
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface RawConnectionDirectoryRow {
  connection_id: string;
  edge_id: string;
  role: string;
  protocol_rev: number;
  device_id: string | null;
  pubkey: string | null;
  label: string | null;
  version: string | null;
  mode: string | null;
  capabilities_json: string;
  ready_capabilities_json: string;
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
  let readyCapabilities: ClientCapability[] = [];
  try {
    const parsed = JSON.parse(raw.ready_capabilities_json) as unknown;
    if (Array.isArray(parsed)) {
      readyCapabilities = parsed.filter((v): v is ClientCapability => typeof v === "string") as ClientCapability[];
    }
  } catch {
    // leave empty
  }
  const role = raw.role === "node" ? "node" : "client";
  return {
    connection_id: raw.connection_id,
    edge_id: raw.edge_id,
    role,
    protocol_rev:
      typeof raw.protocol_rev === "number" && Number.isFinite(raw.protocol_rev)
        ? raw.protocol_rev
        : 1,
    device_id: raw.device_id,
    pubkey: raw.pubkey,
    label: raw.label,
    version: raw.version,
    mode: raw.mode,
    capabilities,
    ready_capabilities: readyCapabilities,
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
    role: "client" | "node";
    protocolRev?: number;
    deviceId?: string | null;
    pubkey?: string | null;
    label?: string | null;
    version?: string | null;
    mode?: string | null;
    capabilities: readonly ClientCapability[];
    readyCapabilities?: readonly ClientCapability[];
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const expiresAtMs = params.nowMs + params.ttlMs;
    const readyCapabilities = params.readyCapabilities ?? (params.capabilities ?? []);
    await this.db.run(
      `INSERT INTO connection_directory (
         connection_id,
         edge_id,
         role,
         protocol_rev,
         device_id,
         pubkey,
         label,
         version,
         mode,
         capabilities_json,
         ready_capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET
         edge_id = excluded.edge_id,
         role = excluded.role,
         protocol_rev = excluded.protocol_rev,
         device_id = excluded.device_id,
         pubkey = excluded.pubkey,
         label = excluded.label,
         version = excluded.version,
         mode = excluded.mode,
         capabilities_json = excluded.capabilities_json,
         ready_capabilities_json = excluded.ready_capabilities_json,
         last_seen_at_ms = excluded.last_seen_at_ms,
         expires_at_ms = excluded.expires_at_ms`,
      [
        params.connectionId,
        params.edgeId,
        params.role,
        params.protocolRev ?? 1,
        params.deviceId ?? null,
        params.pubkey ?? null,
        params.label ?? null,
        params.version ?? null,
        params.mode ?? null,
        JSON.stringify(params.capabilities ?? []),
        JSON.stringify(readyCapabilities),
        params.nowMs,
        params.nowMs,
        expiresAtMs,
      ],
    );
  }

  async setReadyCapabilities(params: {
    connectionId: string;
    readyCapabilities: readonly ClientCapability[];
  }): Promise<void> {
    await this.db.run(
      `UPDATE connection_directory
       SET ready_capabilities_json = ?
       WHERE connection_id = ?`,
      [JSON.stringify(params.readyCapabilities ?? []), params.connectionId],
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
    opts?: { role?: "client" | "node" },
  ): Promise<ConnectionDirectoryRow[]> {
    const rows = await this.listNonExpired(nowMs);
    return rows.filter(
      (r) =>
        r.capabilities.includes(capability) &&
        (opts?.role ? r.role === opts.role : true),
    );
  }
}
