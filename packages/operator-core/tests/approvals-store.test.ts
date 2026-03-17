import { describe, expect, it, vi } from "vitest";
import { ElevatedModeRequiredError } from "../src/elevated-mode.js";
import { createApprovalsStore } from "../src/stores/approvals-store.js";

function makeApproval(
  approvalId: string,
  status: "queued" | "reviewing" | "awaiting_human" | "approved" | "denied" | "expired",
  overrides?: {
    createdAt?: string;
    latestReview?: {
      created_at?: string;
      started_at?: string | null;
      completed_at?: string | null;
      state?: string;
      reason?: string | null;
    } | null;
  },
) {
  return {
    approval_id: approvalId,
    approval_key: `approval:${approvalId}`,
    agent_id: "00000000-0000-4000-8000-000000000002",
    kind: "workflow_step",
    status,
    prompt: `Approve ${approvalId}?`,
    motivation: "Approval is required before execution can continue.",
    created_at: overrides?.createdAt ?? "2026-03-10T00:00:00.000Z",
    expires_at: null,
    latest_review: overrides?.latestReview
      ? {
          review_id: `review:${approvalId}`,
          target_type: "approval",
          target_id: approvalId,
          reviewer_kind: "human",
          reviewer_id: null,
          state: overrides.latestReview.state ?? status,
          reason: overrides.latestReview.reason ?? null,
          risk_level: null,
          risk_score: null,
          evidence: null,
          decision_payload: null,
          created_at: overrides.latestReview.created_at ?? "2026-03-10T00:00:00.000Z",
          started_at: overrides.latestReview.started_at ?? null,
          completed_at: overrides.latestReview.completed_at ?? null,
        }
      : null,
  } as const;
}

describe("approvals-store", () => {
  it("treats queued approvals as human actionable pending work", async () => {
    const queued = makeApproval("11111111-1111-1111-1111-111111111111", "queued");
    const reviewing = makeApproval("22222222-2222-2222-2222-222222222222", "reviewing");
    const awaitingHuman = makeApproval("33333333-3333-3333-3333-333333333333", "awaiting_human");
    const ws = {
      approvalList: vi.fn(async () => ({
        approvals: [queued, reviewing, awaitingHuman],
      })),
    };

    const { store } = createApprovalsStore({ ws: ws as never });
    await store.refreshPending();

    expect(store.getSnapshot().blockedIds).toEqual([
      queued.approval_id,
      reviewing.approval_id,
      awaitingHuman.approval_id,
    ]);
    expect(store.getSnapshot().pendingIds).toEqual([queued.approval_id, awaitingHuman.approval_id]);
    expect(store.getSnapshot().historyIds).toEqual([]);
  });

  it("hydrates recent approval history newest first across terminal statuses", async () => {
    const queued = makeApproval("11111111-1111-1111-1111-111111111111", "queued");
    const approvedNewest = makeApproval("22222222-2222-2222-2222-222222222222", "approved", {
      createdAt: "2026-03-10T00:00:00.000Z",
      latestReview: {
        completed_at: "2026-03-10T00:00:05.000Z",
        state: "approved",
      },
    });
    const deniedMiddle = makeApproval("33333333-3333-3333-3333-333333333333", "denied", {
      createdAt: "2026-03-10T00:00:01.000Z",
      latestReview: {
        completed_at: "2026-03-10T00:00:03.000Z",
        state: "denied",
      },
    });
    const expiredOldest = makeApproval("44444444-4444-4444-4444-444444444444", "expired", {
      createdAt: "2026-03-10T00:00:02.000Z",
      latestReview: {
        completed_at: "2026-03-10T00:00:02.000Z",
        state: "expired",
      },
    });
    const ws = {
      approvalList: vi.fn(async (payload?: { status?: string }) => {
        switch (payload?.status) {
          case "approved":
            return { approvals: [approvedNewest] };
          case "denied":
            return { approvals: [deniedMiddle] };
          case "expired":
            return { approvals: [expiredOldest] };
          case "cancelled":
            return { approvals: [] };
          default:
            return { approvals: [queued] };
        }
      }),
    };

    const { store } = createApprovalsStore({ ws: ws as never });
    await store.refreshPending();

    expect(store.getSnapshot().blockedIds).toEqual([queued.approval_id]);
    expect(store.getSnapshot().pendingIds).toEqual([queued.approval_id]);
    expect(store.getSnapshot().historyIds).toEqual([
      approvedNewest.approval_id,
      deniedMiddle.approval_id,
      expiredOldest.approval_id,
    ]);
  });

  it("passes approve-always payloads through and returns created overrides", async () => {
    const approval = {
      approval_id: "11111111-1111-1111-1111-111111111111",
      approval_key: "approval:1",
      kind: "workflow_step",
      status: "approved",
      prompt: "Approve execution of 'read' (risk=low)",
      motivation: "Approval is required before execution can continue.",
      created_at: "2026-03-10T00:00:00.000Z",
      expires_at: null,
      latest_review: {
        review_id: "55555555-5555-4555-8555-555555555555",
        target_type: "approval",
        target_id: "11111111-1111-1111-1111-111111111111",
        reviewer_kind: "human",
        reviewer_id: null,
        state: "approved",
        reason: "approved",
        risk_level: null,
        risk_score: null,
        evidence: null,
        decision_payload: null,
        created_at: "2026-03-10T00:00:00.000Z",
        started_at: "2026-03-10T00:00:00.500Z",
        completed_at: "2026-03-10T00:00:01.000Z",
      },
    } as const;
    const createdOverride = {
      policy_override_id: "22222222-2222-4222-8222-222222222222",
      status: "active",
      created_at: "2026-03-10T00:00:01.000Z",
      agent_id: "33333333-3333-4333-8333-333333333333",
      workspace_id: "44444444-4444-4444-8444-444444444444",
      tool_id: "read",
      pattern: "read:docs/architecture/gateway/approvals.md",
      created_from_approval_id: approval.approval_id,
    } as const;
    const ws = {
      approvalResolve: vi.fn(async () => ({
        approval,
        created_overrides: [createdOverride],
      })),
    };

    const { store } = createApprovalsStore({ ws: ws as never });
    const result = await store.resolve({
      approvalId: approval.approval_id,
      decision: "approved",
      mode: "always",
      overrides: [
        {
          tool_id: createdOverride.tool_id,
          pattern: createdOverride.pattern,
          workspace_id: createdOverride.workspace_id,
        },
      ],
    });

    expect(ws.approvalResolve).toHaveBeenCalledWith({
      approval_id: approval.approval_id,
      decision: "approved",
      reason: undefined,
      mode: "always",
      overrides: [
        {
          tool_id: createdOverride.tool_id,
          pattern: createdOverride.pattern,
          workspace_id: createdOverride.workspace_id,
        },
      ],
    });
    expect(result).toEqual({
      approval,
      createdOverrides: [createdOverride],
    });
    expect(store.getSnapshot().byId[approval.approval_id]).toEqual(approval);
    expect(store.getSnapshot().historyIds).toEqual([approval.approval_id]);
    expect(store.getSnapshot().pendingIds).toEqual([]);
  });

  it("uses a privileged WS client for approval resolution when provided", async () => {
    const approval = {
      approval_id: "55555555-5555-4555-8555-555555555555",
      approval_key: "approval:privileged",
      kind: "workflow_step",
      status: "approved",
      prompt: "Approve execution of 'write' (risk=medium)",
      created_at: "2026-03-10T00:00:00.000Z",
      expires_at: null,
      resolution: {
        decision: "approved",
        resolved_at: "2026-03-10T00:00:05.000Z",
      },
    } as const;
    const baselineWs = {
      approvalResolve: vi.fn(),
    };
    const privilegedWs = {
      connected: true,
      approvalResolve: vi.fn(async () => ({ approval })),
    };

    const { store } = createApprovalsStore({
      ws: baselineWs as never,
      getPrivilegedWs: () => privilegedWs as never,
    });

    await expect(
      store.resolve({
        approvalId: approval.approval_id,
        decision: "approved",
      }),
    ).resolves.toEqual({
      approval,
      createdOverrides: undefined,
    });

    expect(privilegedWs.approvalResolve).toHaveBeenCalledWith({
      approval_id: approval.approval_id,
      decision: "approved",
      reason: undefined,
      mode: undefined,
      overrides: undefined,
    });
    expect(baselineWs.approvalResolve).not.toHaveBeenCalled();
  });

  it("requires admin access when approval resolution is gated on a privileged WS client", async () => {
    const ws = {
      approvalResolve: vi.fn(),
    };
    const { store } = createApprovalsStore({
      ws: ws as never,
      getPrivilegedWs: () => null,
    });

    await expect(
      store.resolve({
        approvalId: "11111111-1111-1111-1111-111111111111",
        decision: "denied",
      }),
    ).rejects.toThrow(ElevatedModeRequiredError);
    expect(ws.approvalResolve).not.toHaveBeenCalled();
  });
});
