import {
  approvalStatusForReviewMode,
  extractPolicySnapshotId,
  resolveAutoReviewMode,
  withPolicySnapshotContext,
  type PolicyService,
} from "@tyrum/runtime-policy";
import type { NodePairingRequest as NodePairingRequestT } from "@tyrum/contracts";
import type { ApprovalRow } from "../approval/dal.js";
import type { ApprovalDal, CreateApprovalParams } from "../approval/dal.js";
import type { NodePairingDal } from "../node/pairing-dal.js";

export {
  approvalStatusForReviewMode,
  pairingStatusForReviewMode,
  resolveAutoReviewMode,
} from "@tyrum/runtime-policy";

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
