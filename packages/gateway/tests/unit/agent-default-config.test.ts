import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ensureAgentConfigSeeded } from "../../src/modules/agent/default-config.js";
import { loadAgentConfigFromDb } from "../../src/modules/agent/runtime/turn-preparation-helpers.js";
import type { ConversationDal } from "../../src/modules/agent/conversation-dal.js";

describe("agent default config loading", () => {
  const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");
  const containers: GatewayContainer[] = [];

  afterEach(async () => {
    await Promise.all(containers.map(async (container) => await container.db.close()));
    containers.length = 0;
  });

  it("returns runtime defaults without persisting an agent config revision", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
    containers.push(container);
    const tenantId = await container.identityScopeDal.ensureTenantId("agent-default-config");
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "primary-agent");
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agent_configs WHERE tenant_id = ? AND agent_id = ?",
      [tenantId, agentId],
    );

    const config = await loadAgentConfigFromDb(
      {
        opts: { container } as Parameters<typeof loadAgentConfigFromDb>[0]["opts"],
        instanceOwner: "test",
        fetchImpl: globalThis.fetch,
        tenantId,
        secretProvider: undefined,
        conversationDal: { deleteExpired: async () => 0 } as unknown as ConversationDal,
        defaultHeartbeatSeededScopes: new Set<string>(),
        cleanupAtMs: 0,
        setCleanupAtMs: () => {},
      },
      {
        tenantId,
        agentId,
        agentKey: "primary-agent",
      },
    );

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agent_configs WHERE tenant_id = ? AND agent_id = ?",
      [tenantId, agentId],
    );
    expect(before?.count ?? 0).toBe(0);
    expect(config.model.model).toBeNull();
    expect(config.skills.default_mode).toBe("allow");
    expect(config.mcp.bundle).toBe("workspace-default");
    expect(config.mcp.tier).toBe("advanced");
    expect(config.mcp.default_mode).toBe("allow");
    expect(config.mcp.pre_turn_tools).toEqual(["mcp.memory.seed"]);
    expect(config.tools.bundle).toBe("authoring-core");
    expect(config.tools.tier).toBe("default");
    expect(config.tools.default_mode).toBe("allow");
    expect(after?.count ?? 0).toBe(0);
  });

  it("seeds backend-created agent configs with canonical bundle and tier defaults", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
    containers.push(container);
    const tenantId = await container.identityScopeDal.ensureTenantId("seeded-agent-config");
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "primary-agent");

    const seeded = await ensureAgentConfigSeeded({
      db: container.db,
      stateMode: "shared",
      tenantId,
      agentId,
      agentKey: "primary-agent",
      createdBy: { kind: "test" },
      reason: "seed default config",
    });

    const stored = await container.db.get<{ config_json: string; count: number }>(
      `SELECT config_json, COUNT(1) OVER () AS count
       FROM agent_configs
       WHERE tenant_id = ? AND agent_id = ?`,
      [tenantId, agentId],
    );
    const storedConfig = JSON.parse(stored?.config_json ?? "{}") as Record<string, unknown>;
    const storedMcp =
      storedConfig["mcp"] &&
      typeof storedConfig["mcp"] === "object" &&
      !Array.isArray(storedConfig["mcp"])
        ? (storedConfig["mcp"] as Record<string, unknown>)
        : {};
    const storedTools =
      storedConfig["tools"] &&
      typeof storedConfig["tools"] === "object" &&
      !Array.isArray(storedConfig["tools"])
        ? (storedConfig["tools"] as Record<string, unknown>)
        : {};

    expect(seeded.revision).toBe(1);
    expect(seeded.config.mcp.bundle).toBe("workspace-default");
    expect(seeded.config.mcp.tier).toBe("advanced");
    expect(seeded.config.tools.bundle).toBe("authoring-core");
    expect(seeded.config.tools.tier).toBe("default");
    expect(stored?.count ?? 0).toBe(1);
    expect(storedMcp).toMatchObject({
      bundle: "workspace-default",
      tier: "advanced",
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
    });
    expect(storedTools).toMatchObject({
      bundle: "authoring-core",
      tier: "default",
      default_mode: "allow",
    });
  });
});
