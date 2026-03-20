import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PolicyAdminService,
  type PolicyOverrideStore,
  type PolicyOverrideRow,
} from "@tyrum/runtime-policy";

function makeOverride(id = "override-1"): PolicyOverrideRow {
  return {
    policy_override_id: id,
    tenant_id: "tenant-1",
    agent_id: "agent-1",
    workspace_id: "workspace-1",
    tool_id: "tool.desktop.act",
    pattern: "tool.desktop.act",
    status: "active",
    created_at: "2026-03-20T00:00:00.000Z",
    expires_at: null,
    revoked_at: null,
    revoked_reason: null,
    created_by: null,
    created_from_approval_id: null,
    created_from_policy_snapshot_id: null,
  };
}

describe("PolicyAdminService", () => {
  const list = vi.fn<PolicyOverrideStore["list"]>();
  const expireStale = vi.fn<PolicyOverrideStore["expireStale"]>();
  const create = vi.fn<PolicyOverrideStore["create"]>();
  const revoke = vi.fn<PolicyOverrideStore["revoke"]>();

  let service: PolicyAdminService;

  beforeEach(() => {
    list.mockReset();
    expireStale.mockReset();
    create.mockReset();
    revoke.mockReset();
    service = new PolicyAdminService({
      policyOverrideStore: {
        list,
        expireStale,
        create,
        revoke,
      },
    });
  });

  it("creates dedicated routed tool overrides without generic node-dispatch validation", async () => {
    create.mockImplementation(async (input) => ({
      ...makeOverride(),
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      workspace_id: input.workspaceId ?? null,
      tool_id: input.toolId,
      pattern: input.pattern,
      created_by: input.createdBy ?? null,
      created_from_approval_id: input.createdFromApprovalId ?? null,
      created_from_policy_snapshot_id: input.createdFromPolicySnapshotId ?? null,
      expires_at: input.expiresAt ?? null,
    }));

    const isolatedService = new PolicyAdminService({
      policyOverrideStore: {
        list,
        expireStale,
        create,
        revoke,
      },
    });

    const result = await isolatedService.createOverride({
      tenantId: "tenant-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      toolId: "tool.desktop.act",
      pattern: "tool.desktop.act",
      createdBy: { kind: "tenant.token", token_id: "token-1" },
      createdFromApprovalId: "approval-1",
      createdFromPolicySnapshotId: "snapshot-1",
      expiresAt: "2026-03-21T00:00:00.000Z",
    });

    expect(create).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      toolId: "tool.desktop.act",
      pattern: "tool.desktop.act",
      createdBy: { kind: "tenant.token", token_id: "token-1" },
      createdFromApprovalId: "approval-1",
      createdFromPolicySnapshotId: "snapshot-1",
      expiresAt: "2026-03-21T00:00:00.000Z",
    });
    expect(result).toEqual({
      ok: true,
      override: expect.objectContaining({
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        tool_id: "tool.desktop.act",
        pattern: "tool.desktop.act",
        created_from_approval_id: "approval-1",
        created_from_policy_snapshot_id: "snapshot-1",
        expires_at: "2026-03-21T00:00:00.000Z",
      }),
    });
  });

  it("expires stale overrides before listing", async () => {
    list.mockResolvedValue([makeOverride()]);
    expireStale.mockResolvedValue([]);

    const result = await service.listOverrides({
      tenantId: "tenant-1",
      agentId: "agent-1",
      toolId: "tool.desktop.act",
      status: "active",
      limit: 10,
    });

    expect(expireStale).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    expect(list).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      toolId: "tool.desktop.act",
      status: "active",
      limit: 10,
    });
    expect(result).toEqual([makeOverride()]);
  });

  it("forwards revoke requests and returns undefined when missing", async () => {
    revoke.mockResolvedValue(undefined);

    await expect(
      service.revokeOverride({
        tenantId: "tenant-1",
        policyOverrideId: "override-404",
        revokedBy: { kind: "tenant.token", token_id: "token-1" },
        reason: "expired manually",
      }),
    ).resolves.toBeUndefined();

    expect(revoke).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      policyOverrideId: "override-404",
      revokedBy: { kind: "tenant.token", token_id: "token-1" },
      reason: "expired manually",
    });
  });

  it("propagates store failures", async () => {
    const listError = new Error("list failed");
    const createError = new Error("create failed");
    const revokeError = new Error("revoke failed");
    expireStale.mockRejectedValueOnce(listError);
    create.mockRejectedValueOnce(createError);
    revoke.mockRejectedValueOnce(revokeError);

    await expect(service.listOverrides({ tenantId: "tenant-1" })).rejects.toThrow("list failed");
    await expect(
      service.createOverride({
        tenantId: "tenant-1",
        agentId: "agent-1",
        toolId: "tool.desktop.act",
        pattern: "tool.desktop.act",
      }),
    ).rejects.toThrow("create failed");
    await expect(
      service.revokeOverride({
        tenantId: "tenant-1",
        policyOverrideId: "override-1",
      }),
    ).rejects.toThrow("revoke failed");
  });
});
