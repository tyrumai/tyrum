import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  CapabilityDescriptor as CapabilityDescriptorSchema,
  type CapabilityDescriptor,
  normalizeCapabilityDescriptors,
  type NodePairingRequest as NodePairingRequestT,
  type NodePairingTrustLevel,
} from "@tyrum/schemas";
import { NodePairingRequest } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { createHash, randomBytes } from "node:crypto";
import { requireTenantIdValue } from "../identity/scope.js";

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
    // Intentional: treat invalid JSON columns as empty metadata.
    return {};
  }
}

function parseCapabilities(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const descriptors = parsed
      .map((entry) => {
        if (typeof entry === "string") {
          return CapabilityDescriptorSchema.parse({
            id: entry,
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          });
        }
        const result = CapabilityDescriptorSchema.safeParse(entry);
        return result.success ? result.data : null;
      })
      .filter((entry): entry is CapabilityDescriptor => entry !== null);
    return normalizeCapabilityDescriptors(descriptors);
  } catch {
    // Intentional: treat invalid JSON columns as empty capabilities.
  }
  return [];
}

function parseAllowlist(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeCapabilityDescriptors(
      parsed
        .map((entry) => CapabilityDescriptorSchema.safeParse(entry))
        .filter((res) => res.success)
        .map((res) => res.data),
    );
  } catch {
    // Intentional: treat invalid JSON columns as empty allowlists.
    return [];
  }
}

function parseTrustLevel(raw: string): NodePairingTrustLevel | undefined {
  if (raw === "local" || raw === "remote") return raw;
  return undefined;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function generateScopedToken(): string {
  return randomBytes(32).toString("hex");
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

  private requireTenantId(tenantId: string | null | undefined): string {
    return requireTenantIdValue(tenantId);
  }

  async getNodeIdForScopedToken(
    scopedToken: string,
    tenantId?: string,
  ): Promise<string | undefined> {
    const binding = await this.getScopedTokenBinding(scopedToken, tenantId);
    return binding?.nodeId;
  }

  async getScopedTokenBinding(
    scopedToken: string,
    tenantId?: string,
  ): Promise<{ tenantId: string; nodeId: string } | undefined> {
    const token = scopedToken.trim();
    if (token.length === 0) return undefined;
    const hash = sha256Hex(token);
    const row =
      typeof tenantId === "string"
        ? await this.db.get<{ tenant_id: string; node_id: string }>(
            `SELECT tenant_id, node_id
             FROM node_pairings
             WHERE tenant_id = ?
               AND status = 'approved'
               AND scoped_token_sha256 = ?`,
            [this.requireTenantId(tenantId), hash],
          )
        : await this.db.get<{ tenant_id: string; node_id: string }>(
            `SELECT tenant_id, node_id
             FROM node_pairings
             WHERE status = 'approved'
               AND scoped_token_sha256 = ?`,
            [hash],
          );
    return row ? { tenantId: row.tenant_id, nodeId: row.node_id } : undefined;
  }

  async getByNodeId(nodeId: string, tenantId: string): Promise<NodePairingRequestT | undefined> {
    const row = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE tenant_id = ?
         AND node_id = ?`,
      [this.requireTenantId(tenantId), nodeId],
    );
    return row ? toPairing(row) : undefined;
  }

  async getById(pairingId: number, tenantId: string): Promise<NodePairingRequestT | undefined> {
    const row = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE tenant_id = ?
         AND pairing_id = ?`,
      [this.requireTenantId(tenantId), pairingId],
    );
    return row ? toPairing(row) : undefined;
  }

  async list(params: {
    tenantId: string;
    status?: NodePairingStatus;
    limit?: number;
  }): Promise<NodePairingRequestT[]> {
    const tenantId = this.requireTenantId(params.tenantId);
    const where: string[] = [];
    const values: unknown[] = [tenantId];
    where.push("tenant_id = ?");
    if (params.status) {
      where.push("status = ?");
      values.push(params.status);
    }
    const limit = Math.max(1, Math.min(500, params.limit ?? 100));
    const sql =
      `SELECT * FROM node_pairings` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY requested_at DESC LIMIT ?`;
    values.push(limit);
    const rows = await this.db.all<RawNodePairingRow>(sql, values);
    return rows.map(toPairing);
  }

  async upsertOnConnect(params: {
    tenantId: string;
    nodeId: string;
    pubkey?: string | null;
    label?: string | null;
    capabilities: readonly CapabilityDescriptor[];
    metadata?: unknown;
    nowIso?: string;
  }): Promise<NodePairingRequestT> {
    const tenantId = this.requireTenantId(params.tenantId);
    const nowIso = params.nowIso ?? new Date().toISOString();
    const capabilitiesJson = JSON.stringify(
      normalizeCapabilityDescriptors(params.capabilities ?? []),
    );
    const metadataJson = JSON.stringify(params.metadata ?? {});

    const existing = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE tenant_id = ?
         AND node_id = ?`,
      [tenantId, params.nodeId],
    );

    if (!existing) {
      const inserted = await this.db.get<RawNodePairingRow>(
        `INSERT INTO node_pairings (
           tenant_id,
           status,
           node_id,
           pubkey,
           label,
           capabilities_json,
           metadata_json,
           requested_at,
           last_seen_at,
           updated_at
         ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          tenantId,
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
         WHERE tenant_id = ?
           AND node_id = ?`,
        [
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          nowIso,
          nowIso,
          tenantId,
          params.nodeId,
        ],
      );
      const updated = await this.getByNodeId(params.nodeId, tenantId);
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
         WHERE tenant_id = ?
           AND node_id = ?`,
        [
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          nowIso,
          nowIso,
          tenantId,
          params.nodeId,
        ],
      );
      const updated = await this.getByNodeId(params.nodeId, tenantId);
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
           scoped_token_sha256 = NULL,
           requested_at = ?,
           last_seen_at = ?,
           resolved_at = NULL,
           resolved_by_json = NULL,
           resolution_reason = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND node_id = ?`,
      [
        params.pubkey ?? null,
        params.label ?? null,
        capabilitiesJson,
        metadataJson,
        nowIso,
        nowIso,
        nowIso,
        tenantId,
        params.nodeId,
      ],
    );

    const updated = await this.getByNodeId(params.nodeId, tenantId);
    if (!updated) throw new Error("node pairing reset failed");
    return updated;
  }

  async resolve(
    params:
      | {
          tenantId: string;
          pairingId: number;
          decision: "approved";
          reason?: string;
          resolvedBy?: unknown;
          trustLevel: NodePairingTrustLevel;
          capabilityAllowlist: readonly CapabilityDescriptor[];
          nowIso?: string;
        }
      | {
          tenantId: string;
          pairingId: number;
          decision: "denied";
          reason?: string;
          resolvedBy?: unknown;
          nowIso?: string;
        },
  ): Promise<{ pairing: NodePairingRequestT; scopedToken?: string } | undefined> {
    const tenantId = this.requireTenantId(params.tenantId);
    const nowIso = params.nowIso ?? new Date().toISOString();

    const existing = await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE tenant_id = ?
         AND pairing_id = ?
         AND status = 'pending'`,
      [tenantId, params.pairingId],
    );
    if (!existing) return undefined;

    const trustLevel =
      params.decision === "approved"
        ? params.trustLevel
        : (parseTrustLevel(existing.trust_level) ?? "remote");

    const allowlist =
      params.decision === "approved"
        ? normalizeCapabilityDescriptors(params.capabilityAllowlist)
        : parseAllowlist(existing.capability_allowlist_json);

    const scopedToken = params.decision === "approved" ? generateScopedToken() : undefined;
    const scopedTokenSha256 = scopedToken ? sha256Hex(scopedToken) : null;

    const result = await this.db.run(
      `UPDATE node_pairings
       SET status = ?,
           trust_level = ?,
           capability_allowlist_json = ?,
           scoped_token_sha256 = ?,
           resolved_at = ?,
           resolved_by_json = ?,
           resolution_reason = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND pairing_id = ?
         AND status = 'pending'`,
      [
        params.decision,
        trustLevel,
        JSON.stringify(allowlist),
        scopedTokenSha256,
        nowIso,
        JSON.stringify(params.resolvedBy ?? {}),
        params.reason ?? null,
        nowIso,
        tenantId,
        params.pairingId,
      ],
    );
    if (result.changes === 0) return undefined;
    const pairing = await this.getById(params.pairingId, tenantId);
    if (!pairing) return undefined;
    return { pairing, scopedToken };
  }

  async revoke(params: {
    tenantId: string;
    pairingId: number;
    reason?: string;
    resolvedBy?: unknown;
    nowIso?: string;
  }): Promise<NodePairingRequestT | undefined> {
    const tenantId = this.requireTenantId(params.tenantId);
    const nowIso = params.nowIso ?? new Date().toISOString();

    const result = await this.db.run(
      `UPDATE node_pairings
       SET status = 'revoked',
           scoped_token_sha256 = NULL,
           resolved_at = ?,
           resolved_by_json = ?,
           resolution_reason = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND pairing_id = ?
         AND status = 'approved'`,
      [
        nowIso,
        JSON.stringify(params.resolvedBy ?? {}),
        params.reason ?? null,
        nowIso,
        tenantId,
        params.pairingId,
      ],
    );
    if (result.changes === 0) return undefined;
    return await this.getById(params.pairingId, tenantId);
  }
}
