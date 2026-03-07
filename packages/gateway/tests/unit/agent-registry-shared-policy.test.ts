import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";

const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");

describe("AgentRegistry shared policy wiring", () => {
  let container: GatewayContainer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-agent-registry-"));
    container = createContainer(
      { dbPath: ":memory:", migrationsDir, tyrumHome: home },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
  });

  afterEach(async () => {
    await container.db.close();
    await rm(home, { recursive: true, force: true });
  });

  it("applies shared deployment and per-agent policy bundles for named agents", async () => {
    const tenantId = await container.identityScopeDal.ensureTenantId("tenant-a");
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "agent-1");
    const workspaceId = await container.identityScopeDal.ensureWorkspaceId(tenantId, "default");
    await container.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const dal = new PolicyBundleConfigDal(container.db);
    await dal.set({
      scope: { tenantId, scopeKind: "deployment" },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["tool.exec"], require_approval: [], deny: [] },
      },
      createdBy: { kind: "test" },
    });
    await dal.set({
      scope: { tenantId, scopeKind: "agent", agentId },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: [], require_approval: ["tool.exec"], deny: [] },
      },
      createdBy: { kind: "test" },
    });

    const registry = new AgentRegistry({
      container,
      baseHome: home,
      secretProviderForTenant: () => ({ resolve: async () => undefined }) as never,
      defaultPolicyService: container.policyService,
      approvalNotifier: { notify: () => undefined } as never,
      logger: container.logger,
    });

    const evaluation = await registry.getPolicyService("agent-1").evaluateToolCall({
      tenantId,
      agentId,
      workspaceId,
      toolId: "tool.exec",
      toolMatchTarget: "echo ok",
    });

    expect(evaluation.decision).toBe("require_approval");
  });
});
