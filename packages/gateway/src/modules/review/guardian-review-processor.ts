import type { NodePairingRequest } from "@tyrum/contracts";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { ApprovalRow } from "../approval/dal.js";
import { ApprovalDal } from "../approval/dal.js";
import { DesktopEnvironmentDal } from "../desktop-environments/dal.js";
import { enrichPairingWithManagedDesktop } from "../desktop-environments/managed-desktop-reference.js";
import { NodePairingDal } from "../node/pairing-dal.js";
import { WorkboardDal } from "../workboard/dal.js";
import { emitPairingApprovedEvent } from "../../ws/pairing-approved.js";
import type { ApprovalGuardianDecision, PairingGuardianDecision } from "./guardian-review-mode.js";
import {
  buildApprovalReviewMessage,
  buildFailedDecisionPayload,
  buildGuardianApproveDecisionPayload,
  buildGuardianRequestedHumanPayload,
  buildPairingReviewMessage,
  createReviewerSubagent,
  emitApprovalUpdate,
  emitPairingUpdate,
  type GuardianProcessorOptions,
  getOrCreateReviewerRuntime,
  isoToMs,
  isValidGuardianPairingDecision,
  markReviewerClosed,
  markReviewerFailed,
  reviewerTurnMetadata,
  truncateText,
} from "./guardian-review-processor-support.js";

const DEFAULT_TICK_MS = 750;
const DEFAULT_STALE_REVIEW_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 4;

export class GuardianReviewProcessor {
  private readonly approvalDal: ApprovalDal;
  private readonly nodePairingDal: NodePairingDal;
  private readonly workboard: WorkboardDal;
  private readonly tenantId: string;
  private readonly logger?: Logger;
  private readonly staleReviewMs: number;
  private readonly batchSize: number;
  private readonly interval: IntervalScheduler;
  private readonly reviewerRuntimeByTenant = new Map<string, AgentRuntime>();

  constructor(private readonly opts: GuardianProcessorOptions) {
    this.approvalDal = opts.container.approvalDal;
    this.nodePairingDal = opts.container.nodePairingDal;
    this.workboard = new WorkboardDal(opts.container.db);
    this.tenantId = opts.tenantId ?? "00000000-0000-4000-8000-000000000001";
    this.logger = opts.logger;
    this.staleReviewMs = resolvePositiveInt(opts.staleReviewMs, DEFAULT_STALE_REVIEW_MS);
    this.batchSize = resolvePositiveInt(opts.batchSize, DEFAULT_BATCH_SIZE);
    this.interval = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.error("guardian.review_tick_failed", {
          tenant_id: this.tenantId,
          error: message,
        });
      },
      tick: async () => {
        await this.tickOnce();
      },
    });
  }

  start(): void {
    this.interval.start();
  }

  stop(): void {
    this.interval.stop();
    for (const runtime of this.reviewerRuntimeByTenant.values()) {
      void runtime.shutdown();
    }
    this.reviewerRuntimeByTenant.clear();
  }

  async tick(): Promise<void> {
    await this.interval.tick();
  }

  private async tickOnce(): Promise<void> {
    await this.recoverStaleReviews();
    for (let i = 0; i < this.batchSize; i += 1) {
      const approval = await this.claimNextApproval();
      if (approval) {
        await this.processApproval(approval);
        continue;
      }
      const pairing = await this.claimNextPairing();
      if (!pairing) return;
      await this.processPairing(pairing);
    }
  }

  private async recoverStaleReviews(): Promise<void> {
    const staleBefore = Date.now() - this.staleReviewMs;
    const approvals = await this.approvalDal.getByStatus({
      tenantId: this.tenantId,
      status: "reviewing",
    });
    for (const approval of approvals) {
      if ((isoToMs(approval.latest_review?.started_at) ?? Number.MAX_SAFE_INTEGER) > staleBefore) {
        continue;
      }
      const transitioned = await this.approvalDal.transitionWithReview({
        tenantId: approval.tenant_id,
        approvalId: approval.approval_id,
        status: "awaiting_human",
        reviewerKind: "system",
        reviewState: "failed",
        reason: "guardian review timed out; awaiting human review",
        allowedCurrentStatuses: ["reviewing"],
      });
      if (transitioned?.transitioned) {
        await emitApprovalUpdate({ approval: transitioned.approval, deps: this.opts });
      }
    }

    const pairings = await this.nodePairingDal.list({
      tenantId: this.tenantId,
      status: "reviewing",
      limit: 100,
    });
    for (const pairing of pairings) {
      if ((isoToMs(pairing.latest_review?.started_at) ?? Number.MAX_SAFE_INTEGER) > staleBefore) {
        continue;
      }
      const transitioned = await this.nodePairingDal.transitionWithReview({
        tenantId: this.tenantId,
        pairingId: pairing.pairing_id,
        status: "awaiting_human",
        reviewerKind: "system",
        reviewState: "failed",
        reason: "guardian review timed out; awaiting human review",
        allowedCurrentStatuses: ["reviewing"],
      });
      if (transitioned?.transitioned) {
        await emitPairingUpdate({
          tenantId: this.tenantId,
          pairing: transitioned.pairing,
          deps: this.opts,
          scopedToken: transitioned.scopedToken,
        });
      }
    }
  }

  private async claimNextApproval(): Promise<ApprovalRow | undefined> {
    const queued = await this.approvalDal.getByStatus({
      tenantId: this.tenantId,
      status: "queued",
    });
    const next = queued.at(0);
    if (!next) return undefined;

    const subagent = await createReviewerSubagent({
      container: this.opts.container,
      workboard: this.workboard,
      tenantId: next.tenant_id,
    });
    const transitioned = await this.approvalDal.transitionWithReview({
      tenantId: next.tenant_id,
      approvalId: next.approval_id,
      status: "reviewing",
      reviewerKind: "guardian",
      reviewerId: subagent.subagent_id,
      reviewState: "running",
      reason: "Guardian review in progress.",
      allowedCurrentStatuses: ["queued"],
    });
    if (!transitioned?.transitioned) {
      await markReviewerClosed({
        container: this.opts.container,
        workboard: this.workboard,
        tenantId: next.tenant_id,
        subagentId: subagent.subagent_id,
      });
      return undefined;
    }
    await emitApprovalUpdate({ approval: transitioned.approval, deps: this.opts });
    return transitioned.approval;
  }

  private async claimNextPairing(): Promise<NodePairingRequest | undefined> {
    const queued = await this.nodePairingDal.list({
      tenantId: this.tenantId,
      status: "queued",
      limit: 1,
    });
    const next = queued.at(0);
    if (!next) return undefined;

    const subagent = await createReviewerSubagent({
      container: this.opts.container,
      workboard: this.workboard,
      tenantId: this.tenantId,
    });
    const transitioned = await this.nodePairingDal.transitionWithReview({
      tenantId: this.tenantId,
      pairingId: next.pairing_id,
      status: "reviewing",
      reviewerKind: "guardian",
      reviewerId: subagent.subagent_id,
      reviewState: "running",
      reason: "Guardian review in progress.",
      allowedCurrentStatuses: ["queued"],
    });
    if (!transitioned?.transitioned) {
      await markReviewerClosed({
        container: this.opts.container,
        workboard: this.workboard,
        tenantId: this.tenantId,
        subagentId: subagent.subagent_id,
      });
      return undefined;
    }
    await emitPairingUpdate({
      tenantId: this.tenantId,
      pairing: transitioned.pairing,
      deps: this.opts,
      scopedToken: transitioned.scopedToken,
    });
    return transitioned.pairing;
  }

  private async processApproval(approval: ApprovalRow): Promise<void> {
    const subagentId = approval.latest_review?.reviewer_id ?? undefined;
    try {
      const decision = await this.runApprovalReview(approval);
      if (decision.decision === "approve") {
        const resolved = await this.approvalDal.resolveWithEngineAction({
          tenantId: approval.tenant_id,
          approvalId: approval.approval_id,
          decision: "approved",
          reason: decision.reason,
          reviewerKind: "guardian",
          reviewerId: subagentId,
          allowedCurrentStatuses: ["reviewing"],
          resolvedBy: {
            kind: "guardian",
            reviewer_subagent_id: subagentId ?? null,
            risk_level: decision.risk_level,
            risk_score: decision.risk_score,
            evidence: decision.evidence ?? null,
          },
          decisionPayload: buildGuardianApproveDecisionPayload(decision, subagentId),
        });
        if (resolved?.transitioned) {
          await emitApprovalUpdate({ approval: resolved.approval, deps: this.opts });
        }
      } else {
        const transitioned = await this.approvalDal.transitionWithReview({
          tenantId: approval.tenant_id,
          approvalId: approval.approval_id,
          status: "awaiting_human",
          reviewerKind: "guardian",
          reviewerId: subagentId,
          reviewState: "requested_human",
          reason: decision.reason,
          riskLevel: decision.risk_level,
          riskScore: decision.risk_score,
          evidence: decision.evidence,
          decisionPayload: buildGuardianRequestedHumanPayload(decision, subagentId),
          allowedCurrentStatuses: ["reviewing"],
        });
        if (transitioned?.transitioned) {
          await emitApprovalUpdate({ approval: transitioned.approval, deps: this.opts });
        }
      }
      if (subagentId) {
        await markReviewerClosed({
          container: this.opts.container,
          workboard: this.workboard,
          tenantId: approval.tenant_id,
          subagentId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transitioned = await this.approvalDal.transitionWithReview({
        tenantId: approval.tenant_id,
        approvalId: approval.approval_id,
        status: "awaiting_human",
        reviewerKind: "system",
        reviewState: "failed",
        reviewerId: subagentId,
        reason: truncateText(`guardian review failed: ${message}`, 1_000),
        decisionPayload: buildFailedDecisionPayload(message, subagentId),
        allowedCurrentStatuses: ["reviewing"],
      });
      if (transitioned?.transitioned) {
        await emitApprovalUpdate({ approval: transitioned.approval, deps: this.opts });
      }
      if (subagentId) {
        await markReviewerFailed({
          container: this.opts.container,
          workboard: this.workboard,
          tenantId: approval.tenant_id,
          subagentId,
          reason: message,
        });
      }
    }
  }

  private async processPairing(pairing: NodePairingRequest): Promise<void> {
    const subagentId = pairing.latest_review?.reviewer_id ?? undefined;
    try {
      const decision = await this.runPairingReview(pairing);
      if (decision.decision === "approve") {
        const trustLevel = decision.trust_level;
        const capabilityAllowlist = decision.capability_allowlist;
        if (!isValidGuardianPairingDecision(pairing, trustLevel, capabilityAllowlist)) {
          throw new Error(
            "guardian pairing approval missing a valid trust_level/capability_allowlist",
          );
        }

        const resolved = await this.nodePairingDal.resolve({
          tenantId: this.tenantId,
          pairingId: pairing.pairing_id,
          decision: "approved",
          reason: decision.reason,
          reviewerKind: "guardian",
          reviewerId: subagentId,
          trustLevel,
          capabilityAllowlist,
          allowedCurrentStatuses: ["reviewing"],
          resolvedBy: {
            kind: "guardian",
            reviewer_subagent_id: subagentId ?? null,
            risk_level: decision.risk_level,
            risk_score: decision.risk_score,
            evidence: decision.evidence ?? null,
          },
          decisionPayload: buildGuardianApproveDecisionPayload(decision, subagentId, {
            trust_level: trustLevel,
            capability_allowlist: capabilityAllowlist,
          }),
        });
        if (resolved?.pairing) {
          const enrichedPairing = await enrichPairingWithManagedDesktop({
            environmentDal: new DesktopEnvironmentDal(this.opts.container.db),
            tenantId: this.tenantId,
            pairing: resolved.pairing,
          });
          if (resolved.scopedToken && this.opts.ws) {
            emitPairingApprovedEvent(this.opts.ws, this.tenantId, {
              pairing: enrichedPairing,
              nodeId: enrichedPairing.node.node_id,
              scopedToken: resolved.scopedToken,
            });
          }
          await emitPairingUpdate({
            tenantId: this.tenantId,
            pairing: enrichedPairing,
            deps: this.opts,
            scopedToken: resolved.scopedToken,
          });
        }
      } else {
        const transitioned = await this.nodePairingDal.transitionWithReview({
          tenantId: this.tenantId,
          pairingId: pairing.pairing_id,
          status: "awaiting_human",
          reviewerKind: "guardian",
          reviewerId: subagentId,
          reviewState: "requested_human",
          reason: decision.reason,
          riskLevel: decision.risk_level,
          riskScore: decision.risk_score,
          evidence: decision.evidence,
          decisionPayload: buildGuardianRequestedHumanPayload(decision, subagentId, {
            ...(decision.trust_level ? { trust_level: decision.trust_level } : {}),
            ...(decision.capability_allowlist
              ? { capability_allowlist: decision.capability_allowlist }
              : {}),
          }),
          allowedCurrentStatuses: ["reviewing"],
        });
        if (transitioned?.transitioned) {
          await emitPairingUpdate({
            tenantId: this.tenantId,
            pairing: transitioned.pairing,
            deps: this.opts,
            scopedToken: transitioned.scopedToken,
          });
        }
      }
      if (subagentId) {
        await markReviewerClosed({
          container: this.opts.container,
          workboard: this.workboard,
          tenantId: this.tenantId,
          subagentId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transitioned = await this.nodePairingDal.transitionWithReview({
        tenantId: this.tenantId,
        pairingId: pairing.pairing_id,
        status: "awaiting_human",
        reviewerKind: "system",
        reviewerId: subagentId,
        reviewState: "failed",
        reason: truncateText(`guardian review failed: ${message}`, 1_000),
        decisionPayload: buildFailedDecisionPayload(message, subagentId),
        allowedCurrentStatuses: ["reviewing"],
      });
      if (transitioned?.transitioned) {
        await emitPairingUpdate({
          tenantId: this.tenantId,
          pairing: transitioned.pairing,
          deps: this.opts,
          scopedToken: transitioned.scopedToken,
        });
      }
      if (subagentId) {
        await markReviewerFailed({
          container: this.opts.container,
          workboard: this.workboard,
          tenantId: this.tenantId,
          subagentId,
          reason: message,
        });
      }
    }
  }

  private async runApprovalReview(approval: ApprovalRow): Promise<ApprovalGuardianDecision> {
    const subagentId = approval.latest_review?.reviewer_id?.trim();
    if (!subagentId) {
      throw new Error("guardian reviewer subagent id is missing");
    }
    const runtime = await getOrCreateReviewerRuntime({
      cache: this.reviewerRuntimeByTenant,
      container: this.opts.container,
      tenantId: approval.tenant_id,
      secretProviderForTenant: this.opts.secretProviderForTenant,
    });
    const runtimeAgentKey = runtime.agentId;
    if (!runtimeAgentKey) {
      throw new Error("guardian reviewer runtime agent id is missing");
    }
    const conversation = approval.conversation_id
      ? await this.opts.container.conversationDal.getById({
          tenantId: approval.tenant_id,
          conversationId: approval.conversation_id,
        })
      : undefined;
    const result = await runtime.executeGuardianReview({
      channel: "subagent",
      thread_id: subagentId,
      parts: [{ type: "text", text: buildApprovalReviewMessage(approval, conversation) }],
      metadata: reviewerTurnMetadata({
        agentKey: runtimeAgentKey,
        subagentId,
        subjectType: "approval",
        targetId: approval.approval_id,
      }),
    });
    if (result.calls !== 1 || !result.decision) {
      throw new Error(result.error ?? "guardian did not return a single valid approval decision");
    }
    return result.decision as ApprovalGuardianDecision;
  }

  private async runPairingReview(pairing: NodePairingRequest): Promise<PairingGuardianDecision> {
    const subagentId = pairing.latest_review?.reviewer_id?.trim();
    if (!subagentId) {
      throw new Error("guardian reviewer subagent id is missing");
    }
    const runtime = await getOrCreateReviewerRuntime({
      cache: this.reviewerRuntimeByTenant,
      container: this.opts.container,
      tenantId: this.tenantId,
      secretProviderForTenant: this.opts.secretProviderForTenant,
    });
    const runtimeAgentKey = runtime.agentId;
    if (!runtimeAgentKey) {
      throw new Error("guardian reviewer runtime agent id is missing");
    }
    const result = await runtime.executeGuardianReview({
      channel: "subagent",
      thread_id: subagentId,
      parts: [{ type: "text", text: buildPairingReviewMessage(pairing) }],
      metadata: reviewerTurnMetadata({
        agentKey: runtimeAgentKey,
        subagentId,
        subjectType: "pairing",
        targetId: String(pairing.pairing_id),
      }),
    });
    if (result.calls !== 1 || !result.decision) {
      throw new Error(result.error ?? "guardian did not return a single valid pairing decision");
    }
    return result.decision as PairingGuardianDecision;
  }
}
