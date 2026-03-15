import { describe, expect, it, vi } from "vitest";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";
import { awaitApprovalForToolExecution } from "../../src/modules/agent/runtime/tool-set-builder-helpers.js";

const { createReviewedApprovalMock, broadcastApprovalUpdatedMock } = vi.hoisted(() => ({
  createReviewedApprovalMock: vi.fn(),
  broadcastApprovalUpdatedMock: vi.fn(),
}));

vi.mock("../../src/modules/review/review-init.js", () => ({
  createReviewedApproval: createReviewedApprovalMock,
}));

vi.mock("../../src/modules/approval/update-broadcast.js", () => ({
  broadcastApprovalUpdated: broadcastApprovalUpdatedMock,
}));

describe("awaitApprovalForToolExecution", () => {
  it("returns immediately when the approval is cancelled", async () => {
    const approval = {
      approval_id: "approval-1",
      status: "queued",
      prompt: "Approve execution of 'bash'",
      created_at: "2026-03-13T00:00:00.000Z",
      expires_at: "2026-03-13T00:05:00.000Z",
      latest_review: null,
    };
    createReviewedApprovalMock.mockResolvedValueOnce(approval);
    broadcastApprovalUpdatedMock.mockResolvedValue(undefined);

    const approvalDal = {
      expireStale: vi.fn(async () => 0),
      getById: vi.fn(async () => ({
        ...approval,
        status: "cancelled",
        latest_review: {
          reason: "operator cancelled",
        },
      })),
    };
    const tool = {
      id: "bash",
      description: "Execute shell commands.",
      effect: "state_changing",
      keywords: [],
      inputSchema: { type: "object" },
    } satisfies ToolDescriptor;

    const result = await awaitApprovalForToolExecution(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        workspaceId: "workspace-1",
        approvalDal: approvalDal as never,
        protocolDeps: undefined,
        approvalWaitMs: 5_000,
        approvalPollMs: 100,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
        policyService: {} as never,
      },
      tool,
      { command: "echo hi" },
      "tc-1",
      {
        tenantId: "tenant-1",
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      0,
    );

    expect(result).toEqual({
      approved: false,
      status: "cancelled",
      approvalId: "approval-1",
      reason: "operator cancelled",
    });
    expect(approvalDal.expireStale).toHaveBeenCalledTimes(1);
    expect(approvalDal.getById).toHaveBeenCalledTimes(1);
  });
});
