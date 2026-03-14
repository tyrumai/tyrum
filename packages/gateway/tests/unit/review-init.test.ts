import { describe, expect, it, vi } from "vitest";
import {
  approvalStatusForReviewMode,
  createReviewedApproval,
  pairingStatusForReviewMode,
  resolveAutoReviewMode,
} from "../../src/modules/review/review-init.js";

describe("resolveAutoReviewMode", () => {
  it("defaults to auto_review when no policy service is configured", async () => {
    await expect(
      resolveAutoReviewMode({
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("auto_review");
  });

  it("stays guardian-first when policy lookup fails", async () => {
    const policyService = {
      async loadEffectiveBundle() {
        throw new Error("policy backend unavailable");
      },
    };

    await expect(
      resolveAutoReviewMode({
        policyService: policyService as never,
        tenantId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBe("auto_review");
  });

  it("maps modes to the expected initial statuses", () => {
    expect(approvalStatusForReviewMode("auto_review")).toBe("queued");
    expect(approvalStatusForReviewMode("manual_only")).toBe("awaiting_human");
    expect(pairingStatusForReviewMode("auto_review")).toBe("queued");
    expect(pairingStatusForReviewMode("manual_only")).toBe("awaiting_human");
  });

  it("treats emitUpdate failures as best-effort after creating the approval", async () => {
    const approval = {
      tenant_id: "00000000-0000-4000-8000-000000000001",
      approval_id: "00000000-0000-4000-8000-000000000002",
      approval_key: "approval:test",
      agent_id: "00000000-0000-4000-8000-000000000003",
      workspace_id: "00000000-0000-4000-8000-000000000004",
      kind: "policy",
      status: "queued",
      prompt: "Approve?",
      motivation: "Motivation",
      context: {},
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      latest_review: null,
      session_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    } as const;
    const transitionedApproval = {
      ...approval,
      latest_review: {
        review_id: "review-1",
        target_type: "approval",
        target_id: approval.approval_id,
        reviewer_kind: "guardian",
        reviewer_id: null,
        state: "queued",
        reason: "Queued for guardian review.",
        risk_level: null,
        risk_score: null,
        evidence: null,
        decision_payload: null,
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: null,
        completed_at: null,
      },
    };
    const create = vi.fn().mockResolvedValue(approval);
    const transitionWithReview = vi
      .fn()
      .mockResolvedValue({ approval: transitionedApproval, transitioned: true });
    const emitUpdate = vi.fn().mockRejectedValue(new Error("ws persistence failed"));

    await expect(
      createReviewedApproval({
        approvalDal: {
          create,
          transitionWithReview,
        },
        params: {
          tenantId: approval.tenant_id,
          agentId: approval.agent_id,
          workspaceId: approval.workspace_id,
          approvalKey: approval.approval_key,
          prompt: approval.prompt,
          motivation: approval.motivation,
          kind: approval.kind,
        },
        emitUpdate,
      }),
    ).resolves.toEqual(transitionedApproval);

    expect(create).toHaveBeenCalledOnce();
    expect(transitionWithReview).toHaveBeenCalledOnce();
    expect(emitUpdate).toHaveBeenCalledWith(transitionedApproval);
  });
});
