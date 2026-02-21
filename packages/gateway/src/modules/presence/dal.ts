/**
 * Presence data access — tracks connected client/node liveness with TTL.
 */

import type { SqlDb } from "../../statestore/types.js";

export interface PresenceRow {
  client_id: string;
  role: string;
  node_id: string | null;
  agent_id: string | null;
  capabilities: string[];
  connected_at: string;
  last_seen_at: string;
  metadata: unknown | null;
}

interface RawPresenceRow {
  client_id: string;
  role: string;
  node_id: string | null;
  agent_id: string | null;
  capabilities_json: string;
  connected_at: string | Date;
  last_seen_at: string | Date;
  metadata_json: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toPresenceRow(raw: RawPresenceRow): PresenceRow {
  let capabilities: string[] = [];
  try {
    capabilities = JSON.parse(raw.capabilities_json) as string[];
  } catch {
    // leave as empty array
  }
  let metadata: unknown | null = null;
  if (raw.metadata_json !== null) {
    try {
      metadata = JSON.parse(raw.metadata_json) as unknown;
    } catch {
      // leave as null
    }
  }
  return {
    client_id: raw.client_id,
    role: raw.role,
    node_id: raw.node_id,
    agent_id: raw.agent_id,
    capabilities,
    connected_at: normalizeTime(raw.connected_at),
    last_seen_at: normalizeTime(raw.last_seen_at),
    metadata,
  };
}

export class PresenceDal {
  constructor(private readonly db: SqlDb) {}

  async upsert(entry: {
    clientId: string;
    role?: string;
    nodeId?: string;
    agentId?: string;
    capabilities?: string[];
    metadata?: unknown;
  }): Promise<PresenceRow> {
    const nowIso = new Date().toISOString();
    const capabilitiesJson = JSON.stringify(entry.capabilities ?? []);
    const metadataJson = entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null;

    const row = await this.db.get<RawPresenceRow>(
      `INSERT INTO presence_entries (client_id, role, node_id, agent_id, capabilities_json, connected_at, last_seen_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         capabilities_json = excluded.capabilities_json,
         metadata_json = excluded.metadata_json
       RETURNING *`,
      [
        entry.clientId,
        entry.role ?? "client",
        entry.nodeId ?? null,
        entry.agentId ?? null,
        capabilitiesJson,
        nowIso,
        nowIso,
        metadataJson,
      ],
    );
    if (!row) {
      throw new Error("presence upsert failed");
    }
    return toPresenceRow(row);
  }

  async touch(clientId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      "UPDATE presence_entries SET last_seen_at = ? WHERE client_id = ?",
      [nowIso, clientId],
    );
  }

  async remove(clientId: string): Promise<boolean> {
    const result = await this.db.run(
      "DELETE FROM presence_entries WHERE client_id = ?",
      [clientId],
    );
    return (result.changes ?? 0) > 0;
  }

  async listActive(): Promise<PresenceRow[]> {
    const rows = await this.db.all<RawPresenceRow>(
      "SELECT * FROM presence_entries ORDER BY connected_at DESC",
    );
    return rows.map(toPresenceRow);
  }

  async cleanup(ttlMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const result = await this.db.run(
      "DELETE FROM presence_entries WHERE last_seen_at < ?",
      [cutoff],
    );
    return result.changes ?? 0;
  }
}
