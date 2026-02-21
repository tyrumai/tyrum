import type {
  ClientCapability,
  NodePairingDecision,
  NodePairingRequest as NodePairingRequestT,
  NodePairingResolution as NodePairingResolutionT,
  NodePairingStatus as NodePairingStatusT,
} from "@tyrum/schemas";
import { NodePairingResolution } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { NodePairingDal } from "./pairing-dal.js";

function normalizeRemoteIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

function isLoopbackIp(ip: string | undefined): boolean {
  const normalized = normalizeRemoteIp(ip);
  if (!normalized) return false;
  return normalized === "127.0.0.1" || normalized === "::1";
}

export class NodePairingService {
  private readonly dal: NodePairingDal;
  private readonly logger?: Logger;
  private readonly autoApproveLoopback: boolean;

  constructor(
    db: SqlDb,
    opts?: { logger?: Logger; autoApproveLoopback?: boolean },
  ) {
    this.dal = new NodePairingDal(db);
    this.logger = opts?.logger;
    this.autoApproveLoopback = opts?.autoApproveLoopback ?? true;
  }

  async observeNode(params: {
    nodeId: string;
    label?: string;
    capabilities: readonly ClientCapability[];
    metadata?: unknown;
    remoteIp?: string;
    nowIso?: string;
  }): Promise<{ pairing: NodePairingRequestT; isNewRequest: boolean }> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const existing = await this.dal.getByNodeId(params.nodeId);
    const shouldAutoApprove = this.autoApproveLoopback && isLoopbackIp(params.remoteIp);

    if (!existing) {
      const created = await this.dal.upsert({
        nodeId: params.nodeId,
        status: shouldAutoApprove ? "approved" : "pending",
        requestedAt: nowIso,
        nodeLabel: params.label,
        capabilities: params.capabilities,
        lastSeenAt: nowIso,
        metadata: params.metadata,
        resolution: shouldAutoApprove
          ? NodePairingResolution.parse({
              decision: "approved",
              resolved_at: nowIso,
              reason: "auto-approved (loopback)",
            })
          : null,
        resolvedAt: shouldAutoApprove ? nowIso : null,
      });

      if (created.status === "approved") {
        this.logger?.info("node.pairing.auto_approved", {
          pairing_id: created.pairing_id,
          node_id: created.node.node_id,
        });
      } else {
        this.logger?.info("node.pairing.requested", {
          pairing_id: created.pairing_id,
          node_id: created.node.node_id,
        });
      }

      return { pairing: created, isNewRequest: created.status === "pending" };
    }

    let nextStatus: NodePairingStatusT = existing.status;
    let nextRequestedAt = existing.requested_at;
    let nextResolution: NodePairingResolutionT | null = existing.resolution;
    let nextResolvedAt: string | null = existing.resolved_at;

    if (existing.status === "denied" || existing.status === "revoked") {
      nextStatus = shouldAutoApprove ? "approved" : "pending";
      nextRequestedAt = nowIso;
      nextResolution = shouldAutoApprove
        ? NodePairingResolution.parse({
            decision: "approved",
            resolved_at: nowIso,
            reason: "auto-approved (loopback)",
          })
        : null;
      nextResolvedAt = shouldAutoApprove ? nowIso : null;
    }

    const updated = await this.dal.upsert({
      nodeId: params.nodeId,
      status: nextStatus,
      requestedAt: nextRequestedAt,
      nodeLabel: params.label ?? existing.node.label,
      capabilities: params.capabilities,
      lastSeenAt: nowIso,
      metadata: params.metadata ?? existing.node.metadata,
      resolution: nextResolution,
      resolvedAt: nextResolvedAt,
    });

    const isNewRequest =
      existing.status !== "pending" && updated.status === "pending";

    if (isNewRequest) {
      this.logger?.info("node.pairing.requested", {
        pairing_id: updated.pairing_id,
        node_id: updated.node.node_id,
      });
    }

    return { pairing: updated, isNewRequest };
  }

  async listPending(opts?: { limit?: number }): Promise<NodePairingRequestT[]> {
    return await this.dal.listByStatus("pending", opts);
  }

  async resolve(params: {
    nodeId: string;
    decision: NodePairingDecision;
    reason?: string;
    resolvedBy?: unknown;
    nowIso?: string;
  }): Promise<NodePairingRequestT | undefined> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const existing = await this.dal.getByNodeId(params.nodeId);
    if (!existing) return undefined;

    const status =
      params.decision === "approved"
        ? ("approved" as const)
        : params.decision === "denied"
          ? ("denied" as const)
          : ("revoked" as const);

    const resolution = NodePairingResolution.parse({
      decision: params.decision,
      resolved_at: nowIso,
      reason: params.reason,
      resolved_by: params.resolvedBy,
    });

    return await this.dal.upsert({
      nodeId: params.nodeId,
      status,
      requestedAt: existing.requested_at,
      nodeLabel: existing.node.label ?? undefined,
      capabilities: existing.node.capabilities,
      lastSeenAt: existing.node.last_seen_at,
      metadata: existing.node.metadata,
      resolution,
      resolvedAt: nowIso,
    });
  }
}

