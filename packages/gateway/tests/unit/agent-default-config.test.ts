import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
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
    expect(after?.count ?? 0).toBe(0);
  });
});
