import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentConfig, BuiltinMemoryServerSettings, DeploymentConfig } from "@tyrum/schemas";
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

  it("migrates legacy memory.v1 revisions when reading the latest config", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );

    try {
      const dal = new AgentConfigDal(container.db);
      const tenantId = DEFAULT_TENANT_ID;
      const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
      await container.db.run(
        `INSERT INTO agent_configs (
           tenant_id,
           agent_id,
           config_json,
           created_at,
           created_by_json,
           reason,
           reverted_from_revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          agentId,
          JSON.stringify({
            model: { model: "openai/gpt-4.1" },
            memory: {
              v1: {
                enabled: true,
                allow_sensitivities: ["public"],
                keyword: { enabled: false, limit: 25 },
              },
            },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "legacy seed",
          null,
        ],
      );

      const latest = await dal.getLatest({ tenantId, agentId });
      expect(latest?.revision).toBe(2);
      expect(latest?.reason).toBe("migrate legacy memory.v1 config");
      expect(latest?.config.mcp.pre_turn_tools).toEqual(["mcp.memory.seed"]);
      expect(
        BuiltinMemoryServerSettings.parse(latest?.config.mcp.server_settings["memory"]),
      ).toMatchObject({
        enabled: true,
        allow_sensitivities: ["public"],
        keyword: { enabled: false, limit: 25 },
      });

      const original = await dal.getByRevision({ tenantId, agentId, revision: 1 });
      expect(original?.config.mcp.pre_turn_tools).toEqual(["mcp.memory.seed"]);
      expect(
        BuiltinMemoryServerSettings.parse(original?.config.mcp.server_settings["memory"]),
      ).toMatchObject({
        enabled: true,
        allow_sensitivities: ["public"],
        keyword: { enabled: false, limit: 25 },
      });
      expect(original?.configSha256).toBe(
        createHash("sha256").update(JSON.stringify(original?.config)).digest("hex"),
      );

      const revisions = await dal.listRevisions({ tenantId, agentId, limit: 5 });
      const legacyRevision = revisions.find((revision) => revision.revision === 1);
      expect(legacyRevision?.configSha256).toBe(
        createHash("sha256").update(JSON.stringify(legacyRevision?.config)).digest("hex"),
      );
    } finally {
      await container.db.close();
    }
  });
});
