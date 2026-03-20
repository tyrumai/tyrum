import type { ApprovalKind as ApprovalKindT } from "@tyrum/contracts";

export type ApprovalStatus =
  | "queued"
  | "reviewing"
  | "awaiting_human"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export function normalizeApprovalStatus(raw: string): ApprovalStatus {
  if (
    raw === "queued" ||
    raw === "reviewing" ||
    raw === "awaiting_human" ||
    raw === "approved" ||
    raw === "denied" ||
    raw === "expired" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "awaiting_human";
}

export function normalizeApprovalKind(raw: string): ApprovalKindT {
  if (
    raw === "workflow_step" ||
    raw === "intent" ||
    raw === "retry" ||
    raw === "policy" ||
    raw === "budget" ||
    raw === "takeover" ||
    raw === "connector.send" ||
    raw === "work.intervention"
  ) {
    return raw;
  }
  return "policy";
}

export function isApprovalBlockedStatus(status: ApprovalStatus): boolean {
  return status === "queued" || status === "reviewing" || status === "awaiting_human";
}

export function approvalNeedsHumanDecision(status: ApprovalStatus): boolean {
  return status === "awaiting_human";
}

export function isApprovalTerminalStatus(status: ApprovalStatus): boolean {
  return (
    status === "approved" || status === "denied" || status === "expired" || status === "cancelled"
  );
}
