import { describe, expect, it, vi } from "vitest";
import { PolicyBundle } from "@tyrum/contracts";
import {
  PolicyService,
  mergePolicyBundles,
  sha256HexFromString,
  stableJsonStringify,
  type PolicyBundleStore,
  type PolicyOverrideRow,
  type PolicyOverrideStore,
  type PolicySnapshotRow,
  type PolicySnapshotStore,
} from "@tyrum/runtime-policy";

function makeSnapshot(
  bundle: ReturnType<typeof PolicyBundle.parse>,
  id = "snapshot-1",
): PolicySnapshotRow {
  return {
    policy_snapshot_id: id,
    sha256: sha256HexFromString(stableJsonStringify(bundle)),
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
    tool_id: "connector.send",
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

function createStores(input?: {
  snapshotById?: Record<string, PolicySnapshotRow>;
  deploymentBundle?: ReturnType<typeof PolicyBundle.parse> | null;
  agentBundle?: ReturnType<typeof PolicyBundle.parse> | null;
  activeOverrides?: PolicyOverrideRow[];
}) {
  const snapshotDal = {
    getById: vi.fn<PolicySnapshotStore["getById"]>(
      async (_tenantId, policySnapshotId) => input?.snapshotById?.[policySnapshotId],
    ),
    getOrCreate: vi.fn<PolicySnapshotStore["getOrCreate"]>(async (_tenantId, bundle) =>
      makeSnapshot(bundle),
    ),
  };

  const overrideDal = {
    list: vi.fn<PolicyOverrideStore["list"]>(async () => []),
    create: vi.fn<PolicyOverrideStore["create"]>(async () => makeOverride("echo ok")),
    revoke: vi.fn<PolicyOverrideStore["revoke"]>(async () => undefined),
    expireStale: vi.fn<PolicyOverrideStore["expireStale"]>(async () => []),
    listActiveForTool: vi.fn<PolicyOverrideStore["listActiveForTool"]>(
      async () => input?.activeOverrides ?? [],
    ),
  };

  const configStore = {
    getDeploymentPolicyBundle: vi.fn<PolicyBundleStore["getDeploymentPolicyBundle"]>(
      async () => input?.deploymentBundle,
    ),
    getAgentPolicyBundle: vi.fn<PolicyBundleStore["getAgentPolicyBundle"]>(
      async () => input?.agentBundle,
    ),
  };

  return { snapshotDal, overrideDal, configStore };
}

describe("PolicyService", () => {
  it("reports observe-only modes and treats unknown modes as enforce", () => {
    expect(
      new PolicyService({
        snapshotDal: createStores().snapshotDal,
        overrideDal: createStores().overrideDal,
        deploymentPolicy: { mode: "observe" },
      }).isObserveOnly(),
    ).toBe(true);
    expect(
      new PolicyService({
        snapshotDal: createStores().snapshotDal,
        overrideDal: createStores().overrideDal,
        deploymentPolicy: { mode: "observe-only" },
      }).isObserveOnly(),
    ).toBe(true);
    expect(
      new PolicyService({
        snapshotDal: createStores().snapshotDal,
        overrideDal: createStores().overrideDal,
        deploymentPolicy: { mode: "enforce" },
      }).isObserveOnly(),
    ).toBe(false);
    expect(
      new PolicyService({
        snapshotDal: createStores().snapshotDal,
        overrideDal: createStores().overrideDal,
        deploymentPolicy: { mode: "unknown" },
      }).isObserveOnly(),
    ).toBe(false);
  });

  it("fails closed when tenant ids are blank for bundle load and status", async () => {
    const stores = createStores();
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
      configStore: stores.configStore,
    });

    await expect(service.loadEffectiveBundle({ tenantId: " " })).rejects.toThrow(
      "tenantId is required",
    );
    await expect(service.getStatus({ tenantId: " " })).rejects.toThrow("tenantId is required");
  });

  it("merges deployment, agent, and playbook bundles and reports deterministic sources", async () => {
    const deploymentBundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: [],
        deny: [],
      },
    });
    const agentBundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: [],
        require_approval: ["bash"],
        deny: [],
      },
    });
    const playbookBundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: [],
        require_approval: [],
        deny: ["rm"],
      },
    });
    const stores = createStores({
      deploymentBundle,
      agentBundle,
    });
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
      configStore: stores.configStore,
    });

    const result = await service.loadEffectiveBundle({
      tenantId: "tenant-1",
      agentId: "agent-1",
      playbookBundle,
    });

    const expectedBundle = mergePolicyBundles([deploymentBundle, agentBundle, playbookBundle]);
    expect(result.bundle).toEqual(expectedBundle);
    expect(result.sha256).toBe(sha256HexFromString(stableJsonStringify(expectedBundle)));
    expect(result.sources).toEqual({
      deployment: "shared",
      agent: "shared",
      playbook: "inline",
    });
  });

  it("returns approval records when a snapshot is missing", async () => {
    const stores = createStores();
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
    });

    const result = await service.evaluateToolCallFromSnapshot({
      tenantId: "tenant-1",
      policySnapshotId: "missing",
      agentId: "agent-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
    });

    expect(result.decision).toBe("require_approval");
    expect(result.decision_record?.rules[0]?.detail).toContain("missing policy snapshot");
  });

  it("evaluates tool calls from existing snapshots", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: [],
        deny: [],
      },
    });
    const snapshot = makeSnapshot(bundle);
    const stores = createStores({
      snapshotById: { "snapshot-1": snapshot },
    });
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
    });

    const result = await service.evaluateToolCallFromSnapshot({
      tenantId: "tenant-1",
      policySnapshotId: "snapshot-1",
      agentId: "agent-1",
      toolId: "bash",
      toolMatchTarget: "echo ok",
    });

    expect(result.decision).toBe("allow");
    expect(result.policy_snapshot).toEqual(snapshot);
  });

  it("evaluates secrets from snapshots across empty, missing-id, missing-row, and existing cases", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      secrets: {
        default: "allow",
        allow: [],
        require_approval: ["scope:user"],
        deny: ["scope:admin"],
      },
    });
    const snapshot = makeSnapshot(bundle);
    const stores = createStores({
      snapshotById: { "snapshot-1": snapshot },
    });
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
    });

    await expect(
      service.evaluateSecretsFromSnapshot({
        tenantId: "tenant-1",
        policySnapshotId: "snapshot-1",
        secretScopes: [],
      }),
    ).resolves.toEqual({
      decision: "allow",
      decision_record: { decision: "allow", rules: [] },
    });

    await expect(
      service.evaluateSecretsFromSnapshot({
        tenantId: "tenant-1",
        policySnapshotId: " ",
        secretScopes: ["scope:user"],
      }),
    ).resolves.toMatchObject({
      decision: "require_approval",
    });

    await expect(
      service.evaluateSecretsFromSnapshot({
        tenantId: "tenant-1",
        policySnapshotId: "missing",
        secretScopes: ["scope:user"],
      }),
    ).resolves.toMatchObject({
      decision: "require_approval",
    });

    await expect(
      service.evaluateSecretsFromSnapshot({
        tenantId: "tenant-1",
        policySnapshotId: "snapshot-1",
        secretScopes: ["scope:user", "scope:admin"],
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      policy_snapshot: snapshot,
    });
  });

  it("applies connector overrides only when connector policy requires approval", async () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      connectors: {
        default: "require_approval",
        allow: [],
        require_approval: [],
        deny: [],
      },
    });
    const stores = createStores({
      deploymentBundle: bundle,
      activeOverrides: [makeOverride("telegram:thread-1")],
    });
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
      configStore: stores.configStore,
    });

    await expect(
      service.evaluateConnectorAction({
        tenantId: "tenant-1",
        agentId: "agent-1",
        workspaceId: "workspace-1",
        matchTarget: "telegram:thread-1",
      }),
    ).resolves.toMatchObject({
      decision: "allow",
      applied_override_ids: ["override-1"],
    });

    stores.overrideDal.listActiveForTool.mockClear();
    const denyBundle = PolicyBundle.parse({
      v: 1,
      connectors: {
        default: "allow",
        allow: [],
        require_approval: [],
        deny: ["telegram:blocked"],
      },
    });
    stores.configStore.getDeploymentPolicyBundle.mockResolvedValueOnce(denyBundle);

    await expect(
      service.evaluateConnectorAction({
        tenantId: "tenant-1",
        agentId: "agent-1",
        workspaceId: "workspace-1",
        matchTarget: "telegram:blocked",
      }),
    ).resolves.toMatchObject({
      decision: "deny",
      applied_override_ids: undefined,
    });
  });

  it("reports status with observe_only, hash, and effective sources", async () => {
    const deploymentBundle = PolicyBundle.parse({
      v: 1,
      tools: {
        allow: ["bash"],
        require_approval: [],
        deny: [],
      },
    });
    const stores = createStores({ deploymentBundle });
    const service = new PolicyService({
      snapshotDal: stores.snapshotDal,
      overrideDal: stores.overrideDal,
      configStore: stores.configStore,
      deploymentPolicy: { mode: "observe-only" },
    });

    const status = await service.getStatus({
      tenantId: "tenant-1",
      agentId: "agent-1",
    });
    const expectedEffectiveBundle = mergePolicyBundles([deploymentBundle]);

    expect(status.observe_only).toBe(true);
    expect(status.effective_sha256).toBe(
      sha256HexFromString(stableJsonStringify(expectedEffectiveBundle)),
    );
    expect(status.sources).toEqual({
      deployment: "shared",
      agent: null,
    });
  });
});
