/**
 * Node pairing data access layer.
 *
 * Persists node pairing requests and their resolution state so that
 * capability-scoped routing can determine which nodes are approved
 * to participate in the mesh.
 */

import type { SqlDb } from "../../statestore/types.js";

export type PairingStatus = "pending" | "approved" | "denied" | "revoked";

export interface NodeRow {
  node_id: string;
  label: string | null;
  capabilities: string[];
  pairing_status: PairingStatus;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  last_seen_at: string | null;
  metadata: unknown | null;
}

interface RawNodeRow {
  node_id: string;
  label: string | null;
  capabilities: string;
  pairing_status: string;
  requested_at: string | Date;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  last_seen_at: string | null;
  metadata: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNodeRow(raw: RawNodeRow): NodeRow {
  let capabilities: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.capabilities);
    if (Array.isArray(parsed)) {
      capabilities = parsed as string[];
    }
  } catch {
    // leave as empty array
  }

  let metadata: unknown | null = null;
  if (raw.metadata !== null) {
    try {
      metadata = JSON.parse(raw.metadata) as unknown;
    } catch {
      // leave as null
    }
  }

  return {
    node_id: raw.node_id,
    label: raw.label,
    capabilities,
    pairing_status: raw.pairing_status as PairingStatus,
    requested_at: normalizeTime(raw.requested_at),
    resolved_at: raw.resolved_at,
    resolved_by: raw.resolved_by,
    resolution_reason: raw.resolution_reason,
    last_seen_at: raw.last_seen_at,
    metadata,
  };
}

export class NodeDal {
  constructor(private readonly db: SqlDb) {}

  /** Create a new pairing request with status 'pending'. */
  async createPairingRequest(
    nodeId: string,
    label?: string,
    capabilities?: string[],
    metadata?: unknown,
  ): Promise<NodeRow> {
    const capabilitiesJson = JSON.stringify(capabilities ?? []);
    const metadataJson =
      metadata !== undefined ? JSON.stringify(metadata) : null;

    const row = await this.db.get<RawNodeRow>(
      `INSERT INTO nodes (node_id, label, capabilities, metadata)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      [nodeId, label ?? null, capabilitiesJson, metadataJson],
    );
    if (!row) {
      throw new Error("node pairing request insert failed");
    }

    // Sync the node_capabilities junction table
    if (capabilities && capabilities.length > 0) {
      for (const cap of capabilities) {
        await this.db.run(
          `INSERT INTO node_capabilities (node_id, capability) VALUES (?, ?)
           ON CONFLICT DO NOTHING`,
          [nodeId, cap],
        );
      }
    }

    return toNodeRow(row);
  }

  /** Resolve a pending pairing request (approve, deny, or revoke). */
  async resolvePairing(
    nodeId: string,
    decision: "approved" | "denied" | "revoked",
    resolvedBy?: string,
    reason?: string,
  ): Promise<NodeRow | undefined> {
    const nowIso = new Date().toISOString();

    const result = await this.db.run(
      `UPDATE nodes
       SET pairing_status = ?, resolved_at = ?, resolved_by = ?, resolution_reason = ?
       WHERE node_id = ? AND pairing_status = 'pending'`,
      [decision, nowIso, resolvedBy ?? null, reason ?? null, nodeId],
    );
    if (result.changes === 0) return undefined;
    return await this.getById(nodeId);
  }

  /** List nodes, optionally filtered by pairing status. */
  async listNodes(status?: string): Promise<NodeRow[]> {
    if (status) {
      const rows = await this.db.all<RawNodeRow>(
        "SELECT * FROM nodes WHERE pairing_status = ? ORDER BY requested_at ASC",
        [status],
      );
      return rows.map(toNodeRow);
    }

    const rows = await this.db.all<RawNodeRow>(
      "SELECT * FROM nodes ORDER BY requested_at ASC",
    );
    return rows.map(toNodeRow);
  }

  /** Get a single node by ID. */
  async getById(nodeId: string): Promise<NodeRow | undefined> {
    const row = await this.db.get<RawNodeRow>(
      "SELECT * FROM nodes WHERE node_id = ?",
      [nodeId],
    );
    return row ? toNodeRow(row) : undefined;
  }

  /** Revoke a node (sets status to 'revoked' regardless of current status). */
  async revokeNode(nodeId: string): Promise<NodeRow | undefined> {
    const nowIso = new Date().toISOString();

    const result = await this.db.run(
      `UPDATE nodes
       SET pairing_status = 'revoked', resolved_at = ?
       WHERE node_id = ?`,
      [nowIso, nodeId],
    );
    if (result.changes === 0) return undefined;
    return await this.getById(nodeId);
  }

  /** Touch last_seen_at for a node. */
  async updateLastSeen(nodeId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      "UPDATE nodes SET last_seen_at = ? WHERE node_id = ?",
      [nowIso, nodeId],
    );
  }
}
