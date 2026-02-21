import type {
  ClientCapability,
  NodePairingRequest as NodePairingRequestT,
  NodePairingResolution as NodePairingResolutionT,
  NodePairingStatus as NodePairingStatusT,
} from "@tyrum/schemas";
import {
  NodePairingRequest,
  NodePairingResolution,
  NodePairingStatus,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

interface RawNodePairingRow {
  pairing_id: number;
  node_id: string;
  status: string;
  requested_at: string | Date;
  node_label: string | null;
  capabilities_json: string;
  last_seen_at: string | Date;
  metadata_json: string;
  resolution_json: string | null;
  resolved_at: string | Date | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toNodePairingRequest(raw: RawNodePairingRow): NodePairingRequestT {
  const capabilities = parseJsonOr<ClientCapability[]>(raw.capabilities_json, []);
  const metadata = parseJsonOr<unknown>(raw.metadata_json, {});
  const resolutionParsed = raw.resolution_json
    ? NodePairingResolution.safeParse(parseJsonOr<unknown>(raw.resolution_json, null))
    : { success: true as const, data: null as NodePairingResolutionT | null };
  const resolution = resolutionParsed.success ? resolutionParsed.data : null;

  return NodePairingRequest.parse({
    pairing_id: raw.pairing_id,
    status: NodePairingStatus.parse(raw.status),
    requested_at: normalizeTime(raw.requested_at),
    node: {
      node_id: raw.node_id,
      label: raw.node_label ?? undefined,
      capabilities,
      last_seen_at: normalizeTime(raw.last_seen_at),
      metadata,
    },
    resolution,
    resolved_at: raw.resolved_at ? normalizeTime(raw.resolved_at) : null,
  });
}

export class NodePairingDal {
  constructor(private readonly db: SqlDb) {}

  async getByNodeId(nodeId: string): Promise<NodePairingRequestT | undefined> {
    const row = await this.db.get<RawNodePairingRow>(
      `SELECT
         pairing_id,
         node_id,
         status,
         requested_at,
         node_label,
         capabilities_json,
         last_seen_at,
         metadata_json,
         resolution_json,
         resolved_at
       FROM node_pairings
       WHERE node_id = ?`,
      [nodeId],
    );
    return row ? toNodePairingRequest(row) : undefined;
  }

  async listByStatus(
    status: NodePairingStatusT,
    opts?: { limit?: number },
  ): Promise<NodePairingRequestT[]> {
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    const rows = await this.db.all<RawNodePairingRow>(
      `SELECT
         pairing_id,
         node_id,
         status,
         requested_at,
         node_label,
         capabilities_json,
         last_seen_at,
         metadata_json,
         resolution_json,
         resolved_at
       FROM node_pairings
       WHERE status = ?
       ORDER BY requested_at ASC
       LIMIT ${String(limit)}`,
      [status],
    );
    return rows.map(toNodePairingRequest);
  }

  async upsert(params: {
    nodeId: string;
    status: NodePairingStatusT;
    requestedAt: string;
    nodeLabel?: string;
    capabilities: readonly ClientCapability[];
    lastSeenAt: string;
    metadata?: unknown;
    resolution?: NodePairingResolutionT | null;
    resolvedAt?: string | null;
  }): Promise<NodePairingRequestT> {
    const row = await this.db.get<RawNodePairingRow>(
      `INSERT INTO node_pairings (
         node_id,
         status,
         requested_at,
         node_label,
         capabilities_json,
         last_seen_at,
         metadata_json,
         resolution_json,
         resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (node_id) DO UPDATE SET
         status = excluded.status,
         requested_at = excluded.requested_at,
         node_label = excluded.node_label,
         capabilities_json = excluded.capabilities_json,
         last_seen_at = excluded.last_seen_at,
         metadata_json = excluded.metadata_json,
         resolution_json = excluded.resolution_json,
         resolved_at = excluded.resolved_at
       RETURNING *`,
      [
        params.nodeId,
        params.status,
        params.requestedAt,
        params.nodeLabel ?? null,
        JSON.stringify(params.capabilities),
        params.lastSeenAt,
        JSON.stringify(params.metadata ?? {}),
        params.resolution ? JSON.stringify(params.resolution) : null,
        params.resolvedAt ?? null,
      ],
    );
    if (!row) {
      throw new Error("node pairing upsert failed");
    }
    return toNodePairingRequest(row);
  }
}

