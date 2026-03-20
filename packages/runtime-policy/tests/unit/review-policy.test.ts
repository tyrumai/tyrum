import { describe, expect, it, vi } from "vitest";
import {
  approvalStatusForReviewMode,
  extractPolicySnapshotId,
  pairingStatusForReviewMode,
  resolveAutoReviewMode,
  withPolicySnapshotContext,
} from "@tyrum/runtime-policy";

describe("runtime-policy review helpers", () => {
  it("extracts policy snapshot ids from direct and nested contexts", () => {
    expect(extractPolicySnapshotId({ policy_snapshot_id: " direct-id " })).toBe("direct-id");
    expect(extractPolicySnapshotId({ policy: { policy_snapshot_id: " nested-id " } })).toBe(
      "nested-id",
    );
    expect(extractPolicySnapshotId({ policy_snapshot_id: " ", policy: {} })).toBeUndefined();
    expect(extractPolicySnapshotId(null)).toBeUndefined();
  });

  it("fills missing policy snapshot context without overwriting existing values", () => {
    expect(
      withPolicySnapshotContext({
        context: {},
        policySnapshotId: "snapshot-1",
        agentId: "agent-1",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      policy: {
        policy_snapshot_id: "snapshot-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      },
    });

    expect(
      withPolicySnapshotContext({
        context: {
          policy: {
            policy_snapshot_id: "snapshot-2",
            agent_id: "agent-2",
            workspace_id: "workspace-2",
          },
        },
        policySnapshotId: "snapshot-1",
        agentId: "agent-1",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      policy: {
        policy_snapshot_id: "snapshot-2",
        agent_id: "agent-2",
        workspace_id: "workspace-2",
      },
    });
  });

  it("resolves auto review mode from policy service and fails open", async () => {
    await expect(
      resolveAutoReviewMode({
        tenantId: "tenant-1",
      }),
    ).resolves.toBe("auto_review");

    const failingService = {
      loadEffectiveBundle: vi.fn(async () => {
        throw new Error("backend unavailable");
      }),
    };
    await expect(
      resolveAutoReviewMode({
        policyService: failingService as never,
        tenantId: "tenant-1",
      }),
    ).resolves.toBe("auto_review");

    const policyService = {
      loadEffectiveBundle: vi.fn(async () => ({
        bundle: { approvals: { auto_review: { mode: "manual_only" } } },
      })),
    };
    await expect(
      resolveAutoReviewMode({
        policyService: policyService as never,
        tenantId: "tenant-1",
        agentId: "agent-1",
      }),
    ).resolves.toBe("manual_only");
    expect(policyService.loadEffectiveBundle).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
    });
  });

  it("maps review modes to queued and awaiting_human statuses", () => {
    expect(approvalStatusForReviewMode("auto_review")).toBe("queued");
    expect(approvalStatusForReviewMode("manual_only")).toBe("awaiting_human");
    expect(pairingStatusForReviewMode("auto_review")).toBe("queued");
    expect(pairingStatusForReviewMode("manual_only")).toBe("awaiting_human");
  });
});
