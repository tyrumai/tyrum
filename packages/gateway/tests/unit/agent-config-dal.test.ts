import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentConfig, DeploymentConfig } from "@tyrum/schemas";
import { createContainer } from "../../src/container.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentConfigDal", () => {
  it("does not evaluate the default config factory after a config already exists", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );

    try {
      const dal = new AgentConfigDal(container.db);
      const tenantId = DEFAULT_TENANT_ID;
      const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
      const seeded = await dal.ensureSeeded({
        tenantId,
        agentId,
        defaultConfig: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
        }),
        createdBy: { kind: "test" },
      });

      let factoryCalls = 0;
      const existing = await dal.ensureSeeded({
        tenantId,
        agentId,
        defaultConfig: async () => {
          factoryCalls += 1;
          return AgentConfig.parse({
            model: { model: "openai/gpt-4.1-mini" },
          });
        },
        createdBy: { kind: "test" },
      });

      expect(existing.revision).toBe(seeded.revision);
      expect(factoryCalls).toBe(0);
    } finally {
      await container.db.close();
    }
  });
});
