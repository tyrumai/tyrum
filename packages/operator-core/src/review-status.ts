import type { Approval, NodePairingRequest } from "@tyrum/client";

export type ApprovalStatus = Approval["status"];
export type PairingStatus = NodePairingRequest["status"];
type ApprovalLikeStatus = string | null | undefined;
type PairingLikeStatus = string | null | undefined;

function readReviewLikeUpdatedAt(review: unknown): string | null {
  if (!review || typeof review !== "object" || Array.isArray(review)) return null;
  const record = review as Record<string, unknown>;
  const completedAt = record["completed_at"];
  if (typeof completedAt === "string" && completedAt.trim().length > 0) return completedAt;
  const startedAt = record["started_at"];
  if (typeof startedAt === "string" && startedAt.trim().length > 0) return startedAt;
  const createdAt = record["created_at"];
  if (typeof createdAt === "string" && createdAt.trim().length > 0) return createdAt;
  return null;
}

export function isApprovalBlockedStatus(status: ApprovalLikeStatus): boolean {
  return status === "queued" || status === "reviewing" || status === "awaiting_human";
}

export function isApprovalHumanActionableStatus(status: ApprovalLikeStatus): boolean {
  return status === "awaiting_human";
}

export function approvalUpdatedAt(approval: Approval): string {
  return readReviewLikeUpdatedAt(approval.latest_review) ?? approval.created_at;
}

export function isPairingBlockedStatus(status: PairingLikeStatus): boolean {
  return status === "queued" || status === "reviewing" || status === "awaiting_human";
}

export function isPairingHumanActionableStatus(status: PairingLikeStatus): boolean {
  return status === "awaiting_human";
}

export function pairingUpdatedAt(pairing: NodePairingRequest): string {
  return readReviewLikeUpdatedAt(pairing.latest_review) ?? pairing.requested_at;
}
