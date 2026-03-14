import {
  CapabilityDescriptor as CapabilityDescriptorSchema,
  NodePairingRequest,
  type CapabilityDescriptor,
  normalizeCapabilityDescriptors,
  type NodePairingRequest as NodePairingRequestT,
  type NodePairingTrustLevel,
  type ReviewEntry as ReviewEntryT,
} from "@tyrum/schemas";
import { createHash, randomBytes } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { requireTenantIdValue } from "../identity/scope.js";
import { parseStoredCapabilityDescriptors } from "./stored-capability-descriptors.js";
import {
  type CreateReviewEntryParams,
  ReviewEntryDal,
  type ReviewEntryRow,
  type ReviewerKind,
} from "../review/dal.js";

export type NodePairingStatus =
  | "queued"
  | "reviewing"
  | "awaiting_human"
  | "approved"
  | "denied"
  | "revoked";

interface RawNodePairingRow {
  pairing_id: number;
  tenant_id: string;
  status: string;
  trust_level: string;
  node_id: string;
  pubkey: string | null;
  label: string | null;
  capabilities_json: string;
  capability_allowlist_json: string;
  metadata_json: string;
  motivation: string;
  latest_review_id: string | null;
  requested_at: string | Date;
  last_seen_at: string | Date;
  updated_at: string | Date;
  scoped_token_sha256: string | null;
}

function parseJsonOrEmpty(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: malformed node metadata should not block loading the pairing row.
    return {};
  }
}

function parseCapabilities(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseStoredCapabilityDescriptors(parsed);
  } catch {
    // Intentional: capability decoding is best-effort for legacy or malformed stored rows.
    return [];
  }
}

function parseAllowlist(raw: string): CapabilityDescriptor[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeCapabilityDescriptors(
      parsed
        .map((entry) => CapabilityDescriptorSchema.safeParse(entry))
        .filter((result) => result.success)
        .map((result) => result.data),
    );
  } catch {
    // Intentional: allowlist decoding is best-effort for legacy or malformed stored rows.
    return [];
  }
}

function parseTrustLevel(raw: string): NodePairingTrustLevel | undefined {
  if (raw === "local" || raw === "remote") return raw;
  return undefined;
}

function normalizeStatus(raw: string): NodePairingStatus {
  if (
    raw === "queued" ||
    raw === "reviewing" ||
    raw === "awaiting_human" ||
    raw === "approved" ||
    raw === "denied" ||
    raw === "revoked"
  ) {
    return raw;
  }
  return "awaiting_human";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function generateScopedToken(): string {
  return randomBytes(32).toString("hex");
}

function toReviewEntryContract(review: ReviewEntryRow): ReviewEntryT {
  const { tenant_id: _tenantId, ...contract } = review;
  return contract;
}

export function isPairingBlockedStatus(status: NodePairingStatus): boolean {
  return status === "queued" || status === "reviewing" || status === "awaiting_human";
}

export function pairingNeedsHumanDecision(status: NodePairingStatus): boolean {
  return status === "awaiting_human";
}

export class NodePairingDal {
  constructor(private readonly db: SqlDb) {}

  private get reviewEntries(): ReviewEntryDal {
    return new ReviewEntryDal(this.db);
  }

  private requireTenantId(tenantId: string | null | undefined): string {
    return requireTenantIdValue(tenantId);
  }

  private async hydrate(
    row: RawNodePairingRow,
    options?: { includeReviews?: boolean },
  ): Promise<NodePairingRequestT> {
    const latestReview = row.latest_review_id
      ? await this.reviewEntries.getById({
          tenantId: row.tenant_id,
          reviewId: row.latest_review_id,
        })
      : undefined;
    const reviews = options?.includeReviews
      ? await this.reviewEntries.listByTarget({
          tenantId: row.tenant_id,
          targetType: "pairing",
          targetId: row.pairing_id,
        })
      : undefined;
    return NodePairingRequest.parse({
      pairing_id: row.pairing_id,
      status: normalizeStatus(row.status),
      motivation: row.motivation,
      trust_level: parseTrustLevel(row.trust_level),
      requested_at: normalizeDbDateTime(row.requested_at) ?? new Date().toISOString(),
      node: {
        node_id: row.node_id,
        label: row.label ?? undefined,
        capabilities: parseCapabilities(row.capabilities_json),
        last_seen_at: normalizeDbDateTime(row.last_seen_at) ?? new Date().toISOString(),
        metadata: parseJsonOrEmpty(row.metadata_json),
      },
      capability_allowlist: parseAllowlist(row.capability_allowlist_json),
      latest_review: latestReview ? toReviewEntryContract(latestReview) : null,
      ...(reviews ? { reviews: reviews.map(toReviewEntryContract) } : {}),
    });
  }

  private async getRawById(
    pairingId: number,
    tenantId: string,
  ): Promise<RawNodePairingRow | undefined> {
    return await this.db.get<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE tenant_id = ? AND pairing_id = ?`,
      [this.requireTenantId(tenantId), pairingId],
    );
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
    if (!token) return undefined;
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
    return row ? await this.hydrate(row) : undefined;
  }

  async getById(
    pairingId: number,
    tenantId: string,
    includeReviews = false,
  ): Promise<NodePairingRequestT | undefined> {
    const row = await this.getRawById(pairingId, tenantId);
    return row ? await this.hydrate(row, { includeReviews }) : undefined;
  }

  async list(params: {
    tenantId: string;
    status?: NodePairingStatus;
    limit?: number;
  }): Promise<NodePairingRequestT[]> {
    const tenantId = this.requireTenantId(params.tenantId);
    const values: unknown[] = [tenantId];
    const where = ["tenant_id = ?"];
    if (params.status) {
      where.push("status = ?");
      values.push(params.status);
    }
    values.push(Math.max(1, Math.min(500, params.limit ?? 100)));
    const rows = await this.db.all<RawNodePairingRow>(
      `SELECT *
       FROM node_pairings
       WHERE ${where.join(" AND ")}
       ORDER BY requested_at DESC
       LIMIT ?`,
      values,
    );
    return await Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async upsertOnConnect(params: {
    tenantId: string;
    nodeId: string;
    pubkey?: string | null;
    label?: string | null;
    capabilities: readonly CapabilityDescriptor[];
    metadata?: unknown;
    motivation?: string;
    initialStatus?: NodePairingStatus;
    nowIso?: string;
  }): Promise<NodePairingRequestT> {
    const tenantId = this.requireTenantId(params.tenantId);
    const nowIso = params.nowIso ?? new Date().toISOString();
    const capabilitiesJson = JSON.stringify(
      normalizeCapabilityDescriptors(params.capabilities ?? []),
    );
    const metadataJson = JSON.stringify(params.metadata ?? {});
    const motivation =
      params.motivation?.trim() ||
      "Node requested pairing; evaluate trust level and allowed capabilities before enabling node actions.";

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
           motivation,
           latest_review_id,
           requested_at,
           last_seen_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         RETURNING *`,
        [
          tenantId,
          params.initialStatus ?? "queued",
          params.nodeId,
          params.pubkey ?? null,
          params.label ?? null,
          capabilitiesJson,
          metadataJson,
          motivation,
          nowIso,
          nowIso,
          nowIso,
        ],
      );
      if (!inserted) {
        throw new Error("failed to create node pairing");
      }
      return await this.hydrate(inserted);
    }

    const existingStatus = normalizeStatus(existing.status);
    const nextStatus =
      existingStatus === "denied" || existingStatus === "revoked"
        ? (params.initialStatus ?? "queued")
        : existingStatus;
    const clearApprovalState = existingStatus === "denied" || existingStatus === "revoked";

    const updated = await this.db.get<RawNodePairingRow>(
      `UPDATE node_pairings
       SET pubkey = ?,
           label = ?,
           capabilities_json = ?,
           metadata_json = ?,
           motivation = ?,
           status = ?,
           latest_review_id = CASE WHEN ? THEN NULL ELSE latest_review_id END,
           requested_at = CASE WHEN ? THEN ? ELSE requested_at END,
           last_seen_at = ?,
           updated_at = ?,
           trust_level = CASE WHEN ? THEN 'remote' ELSE trust_level END,
           capability_allowlist_json = CASE WHEN ? THEN '[]' ELSE capability_allowlist_json END,
           scoped_token_sha256 = CASE WHEN ? THEN NULL ELSE scoped_token_sha256 END
       WHERE tenant_id = ?
         AND node_id = ?
       RETURNING *`,
      [
        params.pubkey ?? null,
        params.label ?? null,
        capabilitiesJson,
        metadataJson,
        motivation,
        nextStatus,
        clearApprovalState ? 1 : 0,
        clearApprovalState ? 1 : 0,
        nowIso,
        nowIso,
        nowIso,
        clearApprovalState ? 1 : 0,
        clearApprovalState ? 1 : 0,
        clearApprovalState ? 1 : 0,
        tenantId,
        params.nodeId,
      ],
    );
    if (!updated) {
      throw new Error("failed to update node pairing");
    }
    return await this.hydrate(updated);
  }

  async transitionWithReview(input: {
    tenantId: string;
    pairingId: number;
    status: NodePairingStatus;
    reviewerKind: ReviewerKind;
    reviewState: CreateReviewEntryParams["state"];
    reviewerId?: string | null;
    reason?: string;
    riskLevel?: CreateReviewEntryParams["riskLevel"];
    riskScore?: CreateReviewEntryParams["riskScore"];
    evidence?: unknown;
    decisionPayload?: unknown;
    trustLevel?: NodePairingTrustLevel;
    capabilityAllowlist?: readonly CapabilityDescriptor[];
    allowedCurrentStatuses?: NodePairingStatus[];
  }): Promise<
    { pairing: NodePairingRequestT; transitioned: boolean; scopedToken?: string } | undefined
  > {
    return await this.db.transaction(async (tx) => {
      const current = await tx.get<RawNodePairingRow>(
        `SELECT *
         FROM node_pairings
         WHERE tenant_id = ? AND pairing_id = ?`,
        [this.requireTenantId(input.tenantId), input.pairingId],
      );
      if (!current) return undefined;

      const currentStatus = normalizeStatus(current.status);
      if (
        input.allowedCurrentStatuses &&
        !input.allowedCurrentStatuses.includes(currentStatus) &&
        currentStatus !== input.status
      ) {
        return { pairing: await new NodePairingDal(tx).hydrate(current), transitioned: false };
      }
      if (
        currentStatus === input.status &&
        (currentStatus === "approved" || currentStatus === "denied" || currentStatus === "revoked")
      ) {
        return { pairing: await new NodePairingDal(tx).hydrate(current), transitioned: false };
      }

      const review = await new ReviewEntryDal(tx).create({
        tenantId: input.tenantId,
        targetType: "pairing",
        targetId: input.pairingId,
        reviewerKind: input.reviewerKind,
        reviewerId: input.reviewerId,
        state: input.reviewState,
        reason: input.reason,
        riskLevel: input.riskLevel ?? null,
        riskScore: input.riskScore ?? null,
        evidence: input.evidence,
        decisionPayload: input.decisionPayload,
        startedAt: input.reviewState === "running" ? new Date().toISOString() : null,
        completedAt:
          input.reviewState === "running" || input.reviewState === "queued"
            ? null
            : new Date().toISOString(),
      });

      const shouldMintToken = input.status === "approved" && !current.scoped_token_sha256;
      const scopedToken = shouldMintToken ? generateScopedToken() : undefined;
      const scopedTokenSha = scopedToken ? sha256Hex(scopedToken) : current.scoped_token_sha256;

      const updated = await tx.run(
        `UPDATE node_pairings
         SET status = ?,
             latest_review_id = ?,
             trust_level = COALESCE(?, trust_level),
             capability_allowlist_json = COALESCE(?, capability_allowlist_json),
             scoped_token_sha256 = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND pairing_id = ?`,
        [
          input.status,
          review.review_id,
          input.trustLevel ?? null,
          input.capabilityAllowlist
            ? JSON.stringify(normalizeCapabilityDescriptors(input.capabilityAllowlist))
            : null,
          scopedTokenSha ?? null,
          new Date().toISOString(),
          this.requireTenantId(input.tenantId),
          input.pairingId,
        ],
      );
      if (updated.changes !== 1) {
        throw new Error(`failed to update pairing ${String(input.pairingId)}`);
      }

      const next = await new NodePairingDal(tx).getById(input.pairingId, input.tenantId, true);
      if (!next) {
        throw new Error(`pairing ${String(input.pairingId)} disappeared after update`);
      }
      return { pairing: next, transitioned: true, scopedToken };
    });
  }

  async resolve(input: {
    tenantId: string;
    pairingId: number;
    decision: "approved" | "denied";
    reason?: string;
    resolvedBy?: unknown;
    decisionPayload?: unknown;
    reviewerKind?: ReviewerKind;
    reviewerId?: string | null;
    trustLevel?: NodePairingTrustLevel;
    capabilityAllowlist?: readonly CapabilityDescriptor[];
    allowedCurrentStatuses?: NodePairingStatus[];
  }): Promise<
    { pairing: NodePairingRequestT; scopedToken?: string; transitioned: boolean } | undefined
  > {
    const result = await this.transitionWithReview({
      tenantId: input.tenantId,
      pairingId: input.pairingId,
      status: input.decision === "approved" ? "approved" : "denied",
      reviewerKind: input.reviewerKind ?? "human",
      reviewerId: input.reviewerId,
      reviewState: input.decision === "approved" ? "approved" : "denied",
      reason: input.reason,
      decisionPayload: input.decisionPayload ?? input.resolvedBy,
      trustLevel: input.trustLevel,
      capabilityAllowlist: input.capabilityAllowlist,
      allowedCurrentStatuses: input.allowedCurrentStatuses ?? ["queued", "awaiting_human"],
    });
    return result
      ? {
          pairing: result.pairing,
          scopedToken: result.scopedToken,
          transitioned: result.transitioned,
        }
      : undefined;
  }

  async revoke(input: {
    tenantId: string;
    pairingId: number;
    reason?: string;
    resolvedBy?: unknown;
    decisionPayload?: unknown;
    reviewerKind?: ReviewerKind;
    reviewerId?: string | null;
  }): Promise<NodePairingRequestT | undefined> {
    const result = await this.transitionWithReview({
      tenantId: input.tenantId,
      pairingId: input.pairingId,
      status: "revoked",
      reviewerKind: input.reviewerKind ?? "human",
      reviewerId: input.reviewerId,
      reviewState: "revoked",
      reason: input.reason,
      decisionPayload: input.decisionPayload ?? input.resolvedBy,
      allowedCurrentStatuses: ["approved"],
    });
    return result?.pairing;
  }
}
