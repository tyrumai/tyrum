import { describe, expect, it, vi } from "vitest";
import { createApprovalsStore } from "../src/stores/approvals-store.js";

describe("approvals-store", () => {
  it("passes approve-always payloads through and returns created overrides", async () => {
    const approval = {
      approval_id: "11111111-1111-1111-1111-111111111111",
      approval_key: "approval:1",
      kind: "workflow_step",
      status: "approved",
      prompt: "Approve execution of 'read' (risk=low)",
      created_at: "2026-03-10T00:00:00.000Z",
      expires_at: null,
      resolution: {
        decision: "approved",
        resolved_at: "2026-03-10T00:00:01.000Z",
      },
    } as const;
    const createdOverride = {
      policy_override_id: "22222222-2222-4222-8222-222222222222",
      status: "active",
      created_at: "2026-03-10T00:00:01.000Z",
      agent_id: "33333333-3333-4333-8333-333333333333",
      workspace_id: "44444444-4444-4444-8444-444444444444",
      tool_id: "read",
      pattern: "read:docs/architecture/approvals.md",
      created_from_approval_id: approval.approval_id,
    } as const;
    const ws = {
      approvalResolve: vi.fn(async () => ({
        approval,
        created_overrides: [createdOverride],
      })),
    };

    const { store } = createApprovalsStore(ws as never);
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
  });
});
