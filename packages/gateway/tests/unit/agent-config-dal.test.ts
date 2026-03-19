import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentConfig, BuiltinMemoryServerSettings, DeploymentConfig } from "@tyrum/contracts";
import { createContainer } from "../../src/container.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";

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
      const legacyConfigJson = JSON.stringify({
        model: { model: "openai/gpt-4.1" },
        memory: {
          v1: {
            enabled: true,
            allow_sensitivities: ["public"],
            keyword: { enabled: false, limit: 25 },
          },
        },
      });
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
          legacyConfigJson,
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
        createHash("sha256").update(legacyConfigJson).digest("hex"),
      );

      const revisions = await dal.listRevisions({ tenantId, agentId, limit: 5 });
      const legacyRevision = revisions.find((revision) => revision.revision === 1);
      expect(legacyRevision?.configSha256).toBe(
        createHash("sha256").update(legacyConfigJson).digest("hex"),
      );
    } finally {
      await container.db.close();
    }
  });

  it("hashes stored JSON so parsed defaults do not change configSha256", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );

    try {
      const dal = new AgentConfigDal(container.db);
      const tenantId = DEFAULT_TENANT_ID;
      const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
      const rawConfigJson = JSON.stringify({
        model: { model: "openai/gpt-4.1" },
      });
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
          rawConfigJson,
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "legacy shape without defaults",
          null,
        ],
      );

      const latest = await dal.getLatest({ tenantId, agentId });

      expect(latest?.config.sessions.ttl_days).toBe(365);
      expect(latest?.config.tools.default_mode).toBe("allow");
      expect(latest?.configSha256).toBe(createHash("sha256").update(rawConfigJson).digest("hex"));
      expect(latest?.configSha256).not.toBe(
        createHash("sha256").update(JSON.stringify(latest?.config)).digest("hex"),
      );
    } finally {
      await container.db.close();
    }
  });

  it("rechecks the latest revision inside the migration transaction before inserting", async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const agentId = "agent-1";
    const occurredAtIso = "2026-03-13T00:00:00.000Z";
    const legacyConfigJson = JSON.stringify({
      model: { model: "openai/gpt-4.1" },
      memory: {
        v1: {
          enabled: true,
          allow_sensitivities: ["public"],
          keyword: { enabled: false, limit: 25 },
        },
      },
    });
    const migratedConfig = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      mcp: {
        server_settings: {
          memory: {
            enabled: true,
            allow_sensitivities: ["public"],
            keyword: { enabled: false, limit: 25 },
          },
        },
        pre_turn_tools: ["mcp.memory.seed"],
      },
    });
    const migratedConfigJson = JSON.stringify(migratedConfig);

    const legacyRow = {
      revision: 1,
      tenant_id: tenantId,
      agent_id: agentId,
      config_json: legacyConfigJson,
      created_at: occurredAtIso,
      created_by_json: JSON.stringify({ kind: "test" }),
      reason: "legacy seed",
      reverted_from_revision: null,
    };
    const migratedRow = {
      revision: 2,
      tenant_id: tenantId,
      agent_id: agentId,
      config_json: migratedConfigJson,
      created_at: occurredAtIso,
      created_by_json: JSON.stringify({ kind: "system", subsystem: "agent-config-dal" }),
      reason: "migrate legacy memory.v1 config",
      reverted_from_revision: null,
    };

    let insertAttempts = 0;
    const txDb: SqlDb = {
      kind: "postgres",
      get: async <T>(sql: string) => {
        if (sql.includes("FROM agents")) {
          return { agent_id: agentId } as T;
        }
        if (sql.includes("ORDER BY revision DESC")) {
          return migratedRow as T;
        }
        if (sql.includes("INSERT INTO agent_configs")) {
          insertAttempts += 1;
          return undefined;
        }
        return undefined;
      },
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(txDb),
      close: async () => {},
    };
    const rootDb: SqlDb = {
      kind: "postgres",
      get: async <T>(sql: string) => {
        if (sql.includes("ORDER BY revision DESC")) {
          return legacyRow as T;
        }
        return undefined;
      },
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(txDb),
      close: async () => {},
    };

    const latest = await new AgentConfigDal(rootDb).getLatest({ tenantId, agentId });

    expect(insertAttempts).toBe(0);
    expect(latest).toMatchObject({
      revision: 2,
      tenantId,
      agentId,
      reason: "migrate legacy memory.v1 config",
    });
    expect(latest?.configSha256).toBe(
      createHash("sha256").update(migratedConfigJson).digest("hex"),
    );
  });
});
