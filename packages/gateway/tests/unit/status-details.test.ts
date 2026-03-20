import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { buildStatusDetails } from "../../src/modules/observability/status-details.js";

describe("status details sandbox summary", () => {
  const tenantId = "00000000-0000-0000-0000-000000000000";
  const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");
  const containers: GatewayContainer[] = [];

  afterEach(async () => {
    await Promise.all(containers.map(async (container) => await container.db.close()));
    containers.length = 0;
  });

  it("derives elevated execution availability when tools arrays are missing", async () => {
    const details = await buildStatusDetails({
      tenantId,
      policyService: {
        getStatus: async () => ({
          enabled: true,
          observe_only: false,
          effective_sha256: "policy-sha",
          sources: { deployment: "default", agent: null },
        }),
        loadEffectiveBundle: async () => ({
          bundle: {
            v: 1,
            tools: {
              default: "allow",
            },
          },
          sha256: "policy-sha",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
      } as unknown as import("@tyrum/runtime-policy").PolicyService,
    });

    expect(details.sandbox).not.toBeNull();
    expect(details.sandbox?.mode).toBe("enforce");
    expect(details.sandbox?.elevated_execution_available).toBe(true);
    expect(details.sandbox?.hardening_profile).toBe("baseline");
  });

  it("reports hardened profile when configured", async () => {
    const details = await buildStatusDetails({
      tenantId,
      toolrunnerHardeningProfile: "hardened",
      policyService: {
        getStatus: async () => ({
          enabled: true,
          observe_only: false,
          effective_sha256: "policy-sha",
          sources: { deployment: "default", agent: null },
        }),
        loadEffectiveBundle: async () => ({
          bundle: {
            v: 1,
            tools: {
              default: "allow",
            },
          },
          sha256: "policy-sha",
          sources: { deployment: "default", agent: null, playbook: null },
        }),
      } as unknown as import("@tyrum/runtime-policy").PolicyService,
    });

    expect(details.sandbox?.hardening_profile).toBe("hardened");
  });

  it("samples the active model from the primary agent", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
    containers.push(container);
    const scopedTenantId = await container.identityScopeDal.ensureTenantId("status-details");

    await container.db.run(
      `INSERT INTO agents (tenant_id, agent_id, agent_key, is_primary)
       VALUES (?, ?, ?, 0), (?, ?, ?, 1)`,
      [
        scopedTenantId,
        "11111111-1111-4111-8111-111111111111",
        "default",
        scopedTenantId,
        "22222222-2222-4222-8222-222222222222",
        "agent-primary",
      ],
    );

    const getRuntime = vi.fn(async ({ agentKey }: { tenantId: string; agentKey: string }) => ({
      status: async () => ({
        model: {
          model: `openrouter/${agentKey}`,
          fallback: ["openrouter/fallback"],
        },
      }),
    }));

    const details = await buildStatusDetails({
      tenantId: scopedTenantId,
      db: container.db,
      agents: {
        getRuntime,
      } as unknown as import("../../src/modules/agent/registry.js").AgentRegistry,
    });

    expect(getRuntime).toHaveBeenCalledWith({
      tenantId: scopedTenantId,
      agentKey: "agent-primary",
    });
    expect(details.model_auth.active_model).toEqual({
      model_id: "openrouter/agent-primary",
      provider: "openrouter",
      model: "agent-primary",
      fallback_models: ["openrouter/fallback"],
    });
  });
});
