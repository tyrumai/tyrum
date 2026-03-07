import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";

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
    vi.restoreAllMocks();
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

  it("refreshes plugins on cached runtimes when tenant registries change", async () => {
    const tenantId = await container.identityScopeDal.ensureTenantId("tenant-plugins");
    const firstPlugins = Object.create(PluginRegistry.prototype) as PluginRegistry;
    const secondPlugins = Object.create(PluginRegistry.prototype) as PluginRegistry;
    const loadTenantRegistry = vi
      .fn<(_: string) => Promise<PluginRegistry>>()
      .mockResolvedValueOnce(firstPlugins)
      .mockResolvedValueOnce(secondPlugins);
    const setPluginsSpy = vi.spyOn(AgentRuntime.prototype, "setPlugins");

    const registry = new AgentRegistry({
      container,
      baseHome: home,
      secretProviderForTenant: () => ({ resolve: async () => undefined }) as never,
      defaultPolicyService: container.policyService,
      approvalNotifier: { notify: () => undefined } as never,
      pluginCatalogProvider: {
        loadGlobalRegistry: vi.fn(async () => firstPlugins),
        loadTenantRegistry,
        invalidateTenantRegistry: vi.fn(async () => undefined),
        shutdown: vi.fn(async () => undefined),
      },
      logger: container.logger,
    });

    const runtime = await registry.getRuntime({ tenantId, agentKey: "default" });
    expect(await registry.getRuntime({ tenantId, agentKey: "default" })).toBe(runtime);
    expect(loadTenantRegistry).toHaveBeenCalledTimes(2);
    expect(setPluginsSpy).toHaveBeenCalledTimes(1);
    expect(setPluginsSpy).toHaveBeenCalledWith(secondPlugins);

    await registry.shutdown();
  });
});
