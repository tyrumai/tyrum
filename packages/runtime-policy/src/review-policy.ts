import type { PolicyService } from "./service.js";

export type AutoReviewMode = "auto_review" | "manual_only";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractPolicySnapshotId(context: unknown): string | undefined {
  if (!isRecord(context)) return undefined;
  const direct =
    typeof context["policy_snapshot_id"] === "string" ? context["policy_snapshot_id"] : "";
  if (direct.trim().length > 0) {
    return direct.trim();
  }

  const nested = isRecord(context["policy"]) ? context["policy"] : undefined;
  const nestedId =
    typeof nested?.["policy_snapshot_id"] === "string" ? nested["policy_snapshot_id"] : "";
  return nestedId.trim().length > 0 ? nestedId.trim() : undefined;
}

export function withPolicySnapshotContext(input: {
  context: unknown;
  policySnapshotId: string;
  agentId: string;
  workspaceId: string;
}): unknown {
  const base = isRecord(input.context) ? { ...input.context } : {};
  const policy = isRecord(base["policy"]) ? { ...base["policy"] } : {};
  if (
    typeof policy["policy_snapshot_id"] !== "string" ||
    policy["policy_snapshot_id"].trim() === ""
  ) {
    policy["policy_snapshot_id"] = input.policySnapshotId;
  }
  if (typeof policy["agent_id"] !== "string" || policy["agent_id"].trim() === "") {
    policy["agent_id"] = input.agentId;
  }
  if (typeof policy["workspace_id"] !== "string" || policy["workspace_id"].trim() === "") {
    policy["workspace_id"] = input.workspaceId;
  }
  return { ...base, policy };
}

export async function resolveAutoReviewMode(input: {
  policyService?: PolicyService;
  tenantId: string;
  agentId?: string;
}): Promise<AutoReviewMode> {
  if (!input.policyService) {
    return "auto_review";
  }

  try {
    const effective = await input.policyService.loadEffectiveBundle({
      tenantId: input.tenantId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    return effective.bundle.approvals.auto_review.mode;
  } catch {
    return "auto_review";
  }
}

export function approvalStatusForReviewMode(mode: AutoReviewMode): "queued" | "awaiting_human" {
  return mode === "auto_review" ? "queued" : "awaiting_human";
}

export function pairingStatusForReviewMode(mode: AutoReviewMode): "queued" | "awaiting_human" {
  return mode === "auto_review" ? "queued" : "awaiting_human";
}
