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
  it("persists dedicated routed-tool metadata for explicit node approvals", async () => {
    const approval = {
      approval_id: "approval-1",
      status: "approved",
      prompt: "Approve execution of 'tool.desktop.act' on node 'node-1'",
      created_at: "2026-03-13T00:00:00.000Z",
      expires_at: "2026-03-13T00:05:00.000Z",
      latest_review: null,
    };
    createReviewedApprovalMock.mockResolvedValueOnce(approval);
    broadcastApprovalUpdatedMock.mockResolvedValue(undefined);

    const approvalDal = {
      expireStale: vi.fn(async () => 0),
      getById: vi.fn(async () => approval),
    };
    const tool = {
      id: "tool.desktop.act",
      description: "Perform a desktop UI action.",
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
      {
        node_id: "node-1",
        target: { kind: "a11y", role: "button", name: "Submit", states: [] },
        action: { kind: "click" },
      },
      "tc-1",
      {
        tenantId: "tenant-1",
        planId: "plan-1",
        conversationId: "conversation-1",
        channel: "test",
        threadId: "thread-1",
        execution: {
          turnId: "turn-1",
          stepId: "step-1",
          stepIndex: 0,
        },
      },
      0,
    );

    expect(result).toEqual({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
      reason: undefined,
    });
    expect(createReviewedApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          prompt: "Approve execution of 'tool.desktop.act' on node 'node-1'",
          turnId: "turn-1",
          stepId: "step-1",
          context: expect.objectContaining({
            source: "agent-tool-execution",
            tool_id: "tool.desktop.act",
            step_id: "step-1",
            step_index: 0,
            routing: {
              requested_node_id: "node-1",
              selected_node_id: "node-1",
              selection_mode: "explicit",
            },
          }),
        }),
      }),
    );
  });

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
        conversationId: "conversation-1",
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
