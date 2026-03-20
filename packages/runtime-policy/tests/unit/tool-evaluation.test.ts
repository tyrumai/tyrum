import { describe, expect, it, vi } from "vitest";
import { PolicyBundle } from "@tyrum/contracts";
import {
  evaluateToolCallAgainstBundle,
  type PolicyOverrideRow,
  type PolicySnapshotRow,
} from "@tyrum/runtime-policy";

function makeSnapshot(bundle: ReturnType<typeof PolicyBundle.parse>): PolicySnapshotRow {
  return {
    policy_snapshot_id: "snapshot-1",
    sha256: "sha-1",
    created_at: "2026-03-20T00:00:00.000Z",
    bundle,
  };
}

function makeOverride(pattern: string, id = "override-1"): PolicyOverrideRow {
  return {
    policy_override_id: id,
    tenant_id: "tenant-1",
    agent_id: "agent-1",
    workspace_id: "workspace-1",
    tool_id: "bash",
    pattern,
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

describe("evaluateToolCallAgainstBundle", () => {
  it("uses explicit tool-rule precedence with deny over require_approval and allow", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: ["ba*"],
        deny: ["bash"],
      },
    });
    const overrideStore = { listActiveForTool: vi.fn(async () => []) };

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
      overrideStore,
    });

    expect(result.decision).toBe("deny");
    expect(result.decision_record?.rules).toContainEqual(
      expect.objectContaining({
        rule: "tool_policy",
        outcome: "deny",
        detail: "tool_id=bash;source=explicit_rule",
      }),
    );
    expect(overrideStore.listActiveForTool).not.toHaveBeenCalled();
  });

  it("denies immediately when role ceilings disallow the tool", async () => {
    const bundle = PolicyBundle.parse({ v: 1 });
    const overrideStore = { listActiveForTool: vi.fn(async () => []) };

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
      roleAllowed: false,
      overrideStore,
    });

    expect(result.decision).toBe("deny");
    expect(result.decision_record?.rules).toContainEqual(
      expect.objectContaining({
        rule: "tool_policy",
        outcome: "deny",
        detail: "tool_id=bash;source=role_ceiling",
      }),
    );
    expect(overrideStore.listActiveForTool).not.toHaveBeenCalled();
  });

  it("applies implicit tool defaults for read_only, state_changing, memory writes, and bundle fallback", async () => {
    const overrideStore = { listActiveForTool: vi.fn(async () => []) };
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: [],
        deny: [],
      },
    });

    await expect(
      evaluateToolCallAgainstBundle({
        tenantId: "tenant-1",
        bundle,
        snapshot: makeSnapshot(bundle),
        agentId: "agent-1",
        toolId: "filesystem.read",
        toolMatchTarget: "read",
        toolEffect: "read_only",
        overrideStore,
      }).then((result) => result.decision),
    ).resolves.toBe("allow");

    await expect(
      evaluateToolCallAgainstBundle({
        tenantId: "tenant-1",
        bundle,
        snapshot: makeSnapshot(bundle),
        agentId: "agent-1",
        toolId: "filesystem.write",
        toolMatchTarget: "write",
        toolEffect: "state_changing",
        overrideStore,
      }).then((result) => result.decision),
    ).resolves.toBe("require_approval");

    await expect(
      evaluateToolCallAgainstBundle({
        tenantId: "tenant-1",
        bundle,
        snapshot: makeSnapshot(bundle),
        agentId: "agent-1",
        toolId: "mcp.memory.write",
        toolMatchTarget: "write",
        toolEffect: "state_changing",
        overrideStore,
      }).then((result) => result.decision),
    ).resolves.toBe("allow");

    await expect(
      evaluateToolCallAgainstBundle({
        tenantId: "tenant-1",
        bundle,
        snapshot: makeSnapshot(bundle),
        agentId: "agent-1",
        toolId: "bash",
        toolMatchTarget: "echo ok",
        overrideStore,
      }).then((result) => result.decision),
    ).resolves.toBe("allow");
  });

  it("escalates untrusted bash when provenance guardrail is enabled", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: [],
        deny: [],
      },
      provenance: {
        untrusted_shell_requires_approval: true,
      },
    });

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
      inputProvenance: { source: "upload", trusted: false },
      overrideStore: { listActiveForTool: vi.fn(async () => []) },
    });

    expect(result.decision).toBe("require_approval");
    expect(result.decision_record?.rules).toContainEqual(
      expect.objectContaining({
        rule: "provenance",
        outcome: "require_approval",
      }),
    );
  });

  it("adds network egress and secret-scope rules only when applicable and uses the most restrictive result", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["webfetch"],
        require_approval: [],
        deny: [],
      },
      network_egress: {
        default: "allow",
        allow: [],
        require_approval: ["https://example.com/*"],
        deny: [],
      },
      secrets: {
        default: "allow",
        allow: [],
        require_approval: ["scope:user"],
        deny: ["scope:admin"],
      },
    });

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      toolId: "webfetch",
      toolMatchTarget: "https://example.com/api",
      url: "https://example.com/api?q=1",
      secretScopes: ["scope:user", "scope:admin"],
      overrideStore: { listActiveForTool: vi.fn(async () => []) },
    });

    expect(result.decision).toBe("deny");
    expect(result.decision_record?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "network_egress",
          outcome: "require_approval",
          detail: "https://example.com/api",
        }),
        expect.objectContaining({
          rule: "secrets",
          outcome: "deny",
          detail: "scopes=2",
        }),
      ]),
    );
  });

  it("omits network egress rules for blank urls", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["webfetch"],
        require_approval: [],
        deny: [],
      },
    });

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      toolId: "webfetch",
      toolMatchTarget: "https://example.com/api",
      url: "   ",
      overrideStore: { listActiveForTool: vi.fn(async () => []) },
    });

    expect(result.decision_record?.rules.some((rule) => rule.rule === "network_egress")).toBe(
      false,
    );
  });

  it("applies matching policy overrides only for tool-rule approvals", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: [],
        require_approval: ["bash"],
        deny: [],
      },
    });
    const overrideStore = {
      listActiveForTool: vi.fn(async () => [makeOverride("echo ok")]),
    };

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      workspaceId: "workspace-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
      overrideStore,
    });

    expect(result.decision).toBe("allow");
    expect(result.applied_override_ids).toEqual(["override-1"]);
    expect(result.decision_record?.rules).toContainEqual(
      expect.objectContaining({
        rule: "policy_override",
        outcome: "allow",
      }),
    );
  });

  it("does not apply overrides when approval comes from non-tool gates", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["webfetch"],
        require_approval: [],
        deny: [],
      },
      network_egress: {
        default: "require_approval",
        allow: [],
        require_approval: [],
        deny: [],
      },
    });
    const overrideStore = {
      listActiveForTool: vi.fn(async () => [makeOverride("https://example.com/api")]),
    };

    const result = await evaluateToolCallAgainstBundle({
      tenantId: "tenant-1",
      bundle,
      snapshot: makeSnapshot(bundle),
      agentId: "agent-1",
      workspaceId: "workspace-1",
      toolId: "webfetch",
      toolMatchTarget: "https://example.com/api",
      url: "https://example.com/api",
      overrideStore,
    });

    expect(result.decision).toBe("require_approval");
    expect(result.applied_override_ids).toBeUndefined();
    expect(overrideStore.listActiveForTool).not.toHaveBeenCalled();
  });
});
