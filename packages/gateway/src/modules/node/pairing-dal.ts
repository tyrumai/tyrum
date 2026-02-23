import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor as CapabilityDescriptorSchema,
  descriptorIdForClientCapability,
  type CapabilityDescriptor,
  type ClientCapability,
  type NodePairingRequest as NodePairingRequestT,
  type NodePairingTrustLevel,
} from "@tyrum/schemas";
import { NodePairingRequest } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

type NodePairingStatus = "pending" | "approved" | "denied" | "revoked";

interface RawNodePairingRow {
  pairing_id: number;
  status: string;
  trust_level: string;
  node_id: string;
  pubkey: string | null;
  label: string | null;
  capabilities_json: string;
  capability_allowlist_json: string;
  metadata_json: string;
  requested_at: string | Date;
  last_seen_at: string | Date;
  resolved_at: string | Date | null;
  resolved_by_json: string | null;
  resolution_reason: string | null;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOrEmpty(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function parseCapabilities(raw: string): ClientCapability[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is ClientCapability => typeof v === "string") as ClientCapability[];
    }
  } catch {
    // ignore
  }
  return [];
}

function parseAllowlist(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => CapabilityDescriptorSchema.safeParse(entry))
      .filter((res) => res.success)
      .map((res) => res.data);
  } catch {
    return [];
  }
}

function parseTrustLevel(raw: string): NodePairingTrustLevel | undefined {
  if (raw === "local" || raw === "remote") return raw;
  return undefined;
}

function allowlistFromCapabilities(capabilitiesJson: string): CapabilityDescriptor[] {
  const caps = parseCapabilities(capabilitiesJson);
  return [
    ...new Map(
      caps.map((capability) => [
        capability,
        { id: descriptorIdForClientCapability(capability), version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
      ]),
    ).values(),
  ];
}

function toPairing(row: RawNodePairingRow): NodePairingRequestT {
  const status: NodePairingStatus =
    row.status === "approved" || row.status === "denied" || row.status === "revoked"
      ? row.status
      : "pending";

  const requestedAt = normalizeTime(row.requested_at);
  const lastSeenAt = normalizeTime(row.last_seen_at);
  const resolvedAt = row.resolved_at ? normalizeTime(row.resolved_at) : null;

  const resolution =
    status === "pending"
      ? null
      : {
          decision: status,
          resolved_at: resolvedAt ?? requestedAt,
          reason: row.resolution_reason ?? undefined,
          resolved_by: row.resolved_by_json ? parseJsonOrEmpty(row.resolved_by_json) : undefined,
        };

  return NodePairingRequest.parse({
    pairing_id: row.pairing_id,
    status,
    trust_level: parseTrustLevel(row.trust_level),
    requested_at: requestedAt,
    node: {
      node_id: row.node_id,
      label: row.label ?? undefined,
      capabilities: parseCapabilities(row.capabilities_json),
      last_seen_at: lastSeenAt,
      metadata: parseJsonOrEmpty(row.metadata_json),
    },
    capability_allowlist: parseAllowlist(row.capability_allowlist_json),
    resolution,
    resolved_at: resolvedAt,
  });
}

export class NodePairingDal {
  constructor(private readonly db: SqlDb) {}

  async getByNodeId(nodeId: string): Promise<NodePairingRequestT | undefined> {
    const row = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE node_id = ?`,
      [nodeId],
    );
    return row ? toPairing(row) : undefined;
  }

  async getById(pairingId: number): Promise<NodePairingRequestT | undefined> {
    const row = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE pairing_id = ?`,
      [pairingId],
    );
    return row ? toPairing(row) : undefined;
  }

  async list(params?: { status?: NodePairingStatus; limit?: number }): Promise<NodePairingRequestT[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    if (params?.status) {
      where.push("status = ?");
      values.push(params.status);
    }
    const limit = Math.max(1, Math.min(500, params?.limit ?? 100));
    const sql =
      `SELECT * FROM node_pairings` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY requested_at DESC LIMIT ?`;
    values.push(limit);
    const rows = await this.db.all<RawNodePairingRow>(sql, values);
    return rows.map(toPairing);
  }

  async upsertOnConnect(params: {
    nodeId: string;
    pubkey?: string | null;
    label?: string | null;
    capabilities: readonly ClientCapability[];
    metadata?: unknown;
    nowIso?: string;
  }): Promise<NodePairingRequestT> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const capabilitiesJson = JSON.stringify(params.capabilities ?? []);
    const metadataJson = JSON.stringify(params.metadata ?? {});

    const existing = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE node_id = ?`,
      [params.nodeId],
    );

    if (!existing) {
      const inserted = await this.db.get<RawNodePairingRow>(
        `INSERT INTO node_pairings (
           status,
           node_id,
           pubkey,
           label,
           capabilities_json,
           metadata_json,
           requested_at,
           last_seen_at,
           updated_at
         ) VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          params.nodeId,
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          nowIso,
          nowIso,
          nowIso,
        ],
      );
      if (!inserted) {
        throw new Error("node pairing insert failed");
      }
      return toPairing(inserted);
    }

    const status = existing.status as NodePairingStatus;
    if (status === "approved") {
      await this.db.run(
        `UPDATE node_pairings
         SET pubkey = COALESCE(?, pubkey),
             label = COALESCE(?, label),
             capabilities_json = ?,
             metadata_json = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE node_id = ?`,
        [
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          nowIso,
          nowIso,
          params.nodeId,
        ],
      );
      const updated = await this.getByNodeId(params.nodeId);
      if (!updated) throw new Error("node pairing update failed");
      return updated;
    }

    if (status === "pending") {
      await this.db.run(
        `UPDATE node_pairings
         SET pubkey = COALESCE(?, pubkey),
             label = COALESCE(?, label),
             capabilities_json = ?,
             metadata_json = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE node_id = ?`,
        [
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          nowIso,
          nowIso,
          params.nodeId,
        ],
      );
      const updated = await this.getByNodeId(params.nodeId);
      if (!updated) throw new Error("node pairing pending update failed");
      return updated;
    }

    // If the node was denied/revoked, a reconnect re-opens pairing as pending.
    await this.db.run(
      `UPDATE node_pairings
       SET status = 'pending',
           pubkey = COALESCE(?, pubkey),
           label = COALESCE(?, label),
           capabilities_json = ?,
           metadata_json = ?,
           requested_at = ?,
           last_seen_at = ?,
           resolved_at = NULL,
           resolved_by_json = NULL,
           resolution_reason = NULL,
           updated_at = ?
       WHERE node_id = ?`,
      [
        params.pubkey ?? null,
        params.label ?? null,
        capabilitiesJson,
        metadataJson,
        nowIso,
        nowIso,
        nowIso,
        params.nodeId,
      ],
    );

    const updated = await this.getByNodeId(params.nodeId);
    if (!updated) throw new Error("node pairing reset failed");
    return updated;
  }

  async resolve(params: {
    pairingId: number;
    decision: Exclude<NodePairingStatus, "pending">;
    reason?: string;
    resolvedBy?: unknown;
    trustLevel?: NodePairingTrustLevel;
    capabilityAllowlist?: readonly CapabilityDescriptor[];
    nowIso?: string;
  }): Promise<NodePairingRequestT | undefined> {
    const nowIso = params.nowIso ?? new Date().toISOString();

    const existing = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE pairing_id = ?
         AND status = 'pending'`,
      [params.pairingId],
    );
    if (!existing) return undefined;

    const trustLevel =
      params.decision === "approved"
        ? params.trustLevel ?? parseTrustLevel(existing.trust_level) ?? "remote"
        : parseTrustLevel(existing.trust_level) ?? "remote";

    const allowlist =
      params.decision === "approved"
        ? params.capabilityAllowlist ??
          (parseAllowlist(existing.capability_allowlist_json).length > 0
            ? parseAllowlist(existing.capability_allowlist_json)
            : allowlistFromCapabilities(existing.capabilities_json))
        : parseAllowlist(existing.capability_allowlist_json);

    const result = await this.db.run(
      `UPDATE node_pairings
       SET status = ?,
           trust_level = ?,
           capability_allowlist_json = ?,
           resolved_at = ?,
           resolved_by_json = ?,
           resolution_reason = ?,
           updated_at = ?
       WHERE pairing_id = ?
         AND status = 'pending'`,
      [
        params.decision,
        trustLevel,
        JSON.stringify(allowlist),
        nowIso,
        JSON.stringify(params.resolvedBy ?? {}),
        params.reason ?? null,
        nowIso,
        params.pairingId,
      ],
    );
    if (result.changes === 0) return undefined;
    return await this.getById(params.pairingId);
  }

  async revoke(params: {
    pairingId: number;
    reason?: string;
    resolvedBy?: unknown;
    nowIso?: string;
  }): Promise<NodePairingRequestT | undefined> {
    const nowIso = params.nowIso ?? new Date().toISOString();

    const result = await this.db.run(
      `UPDATE node_pairings
       SET status = 'revoked',
           resolved_at = ?,
           resolved_by_json = ?,
           resolution_reason = ?,
           updated_at = ?
       WHERE pairing_id = ?
         AND status = 'approved'`,
      [
        nowIso,
        JSON.stringify(params.resolvedBy ?? {}),
        params.reason ?? null,
        nowIso,
        params.pairingId,
      ],
    );
    if (result.changes === 0) return undefined;
    return await this.getById(params.pairingId);
  }
}
