import type { NodePairingRequest as NodePairingRequestT } from "@tyrum/contracts";
import type { ApprovalRow } from "../approval/dal.js";
import type { ApprovalDal, ApprovalStatus, CreateApprovalParams } from "../approval/dal.js";
import type { NodePairingDal, NodePairingStatus } from "../node/pairing-dal.js";
import type { PolicyService } from "../policy/service.js";

type AutoReviewMode = "auto_review" | "manual_only";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractPolicySnapshotId(context: unknown): string | undefined {
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

function withPolicySnapshotContext(input: {
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
    // Intentional: fall back to guardian-first review if policy lookup is unavailable.
    // Keep guardian-first review as the safe default even if policy lookup fails.
    return "auto_review";
  }
}

export function approvalStatusForReviewMode(mode: AutoReviewMode): ApprovalStatus {
  return mode === "auto_review" ? "queued" : "awaiting_human";
}

export function pairingStatusForReviewMode(mode: AutoReviewMode): NodePairingStatus {
  return mode === "auto_review" ? "queued" : "awaiting_human";
}

export async function createReviewedApproval(input: {
  approvalDal: Pick<ApprovalDal, "create" | "transitionWithReview">;
  policyService?: PolicyService;
  params: CreateApprovalParams;
  emitUpdate?: (approval: ApprovalRow) => Promise<void> | void;
}): Promise<ApprovalRow> {
  const mode = await resolveAutoReviewMode({
    policyService: input.policyService,
    tenantId: input.params.tenantId,
    agentId: input.params.agentId,
  });

  let context = input.params.context;
  if (input.policyService && !extractPolicySnapshotId(context)) {
    try {
      const effective = await input.policyService.loadEffectiveBundle({
        tenantId: input.params.tenantId,
        agentId: input.params.agentId,
      });
      const snapshot = await input.policyService.getOrCreateSnapshot(
        input.params.tenantId,
        effective.bundle,
      );
      context = withPolicySnapshotContext({
        context,
        policySnapshotId: snapshot.policy_snapshot_id,
        agentId: input.params.agentId,
        workspaceId: input.params.workspaceId,
      });
    } catch {
      // Intentional: approval creation still succeeds even if policy snapshot enrichment fails.
      // Approval creation still proceeds in guardian-first mode if policy lookup is unavailable.
    }
  }

  const status = approvalStatusForReviewMode(mode);
  const approval = await input.approvalDal.create({
    ...input.params,
    status,
    context,
  });
  if (
    approval.latest_review ||
    (approval.status !== "queued" && approval.status !== "awaiting_human")
  ) {
    return approval;
  }

  const initialized = await input.approvalDal.transitionWithReview({
    tenantId: approval.tenant_id,
    approvalId: approval.approval_id,
    status,
    reviewerKind: status === "queued" ? "guardian" : "system",
    reviewState: status === "queued" ? "queued" : "requested_human",
    reason: status === "queued" ? "Queued for guardian review." : "Awaiting human review.",
    allowedCurrentStatuses: [status],
  });
  const next = initialized?.approval ?? approval;
  if (initialized?.transitioned) {
    try {
      await input.emitUpdate?.(next);
    } catch {
      // Intentional: approval update notifications are best-effort and must not roll back creation.
    }
  }
  return next;
}

export async function initializePairingReview(input: {
  nodePairingDal: Pick<NodePairingDal, "transitionWithReview">;
  tenantId: string;
  pairing: NodePairingRequestT;
}): Promise<NodePairingRequestT> {
  if (
    input.pairing.latest_review ||
    (input.pairing.status !== "queued" && input.pairing.status !== "awaiting_human")
  ) {
    return input.pairing;
  }

  const initialized = await input.nodePairingDal.transitionWithReview({
    tenantId: input.tenantId,
    pairingId: input.pairing.pairing_id,
    status: input.pairing.status,
    reviewerKind: input.pairing.status === "queued" ? "guardian" : "system",
    reviewState: input.pairing.status === "queued" ? "queued" : "requested_human",
    reason:
      input.pairing.status === "queued" ? "Queued for guardian review." : "Awaiting human review.",
    allowedCurrentStatuses: [input.pairing.status],
  });
  return initialized?.pairing ?? input.pairing;
}
