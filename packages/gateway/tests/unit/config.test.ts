import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "../../src/container.js";
import { DeploymentConfig } from "@tyrum/contracts";
import { DeploymentConfigDal } from "../../src/modules/config/deployment-config-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("DeploymentConfigDal", () => {
  it("seeds a default revision on first access", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );
    try {
      const dal = new DeploymentConfigDal(container.db);
      const first = await dal.ensureSeeded({
        defaultConfig: DeploymentConfig.parse({}),
        createdBy: { kind: "test" },
        reason: "seed",
      });
      expect(first.revision).toBe(1);

      const second = await dal.ensureSeeded({
        defaultConfig: DeploymentConfig.parse({}),
        createdBy: { kind: "test" },
        reason: "ignored",
      });
      expect(second.revision).toBe(first.revision);
    } finally {
      await container.db.close();
    }
  });

  it("can update and revert revisions", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );
    try {
      const dal = new DeploymentConfigDal(container.db);
      const seeded = await dal.ensureSeeded({
        defaultConfig: DeploymentConfig.parse({}),
        createdBy: { kind: "test" },
      });

      const updated = await dal.set({
        config: DeploymentConfig.parse({
          server: {
            publicBaseUrl: "http://127.0.0.1:8788",
            allowInsecureHttp: true,
          },
        }),
        createdBy: { kind: "test" },
        reason: "enable insecure http",
      });
      expect(updated.revision).toBeGreaterThan(seeded.revision);
      expect(updated.config.server.allowInsecureHttp).toBe(true);

      const reverted = await dal.revertToRevision({
        revision: seeded.revision,
        createdBy: { kind: "test" },
        reason: "rollback",
      });
      expect(reverted.config.server.allowInsecureHttp).toBe(false);
      expect(reverted.revertedFromRevision).toBe(seeded.revision);
    } finally {
      await container.db.close();
    }
  });

  it("loads persisted revisions that still contain legacy execution.engineApiEnabled", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );
    try {
      await container.db.run(
        `INSERT INTO deployment_configs (config_json, created_at, created_by_json, reason, reverted_from_revision)
         VALUES (?, ?, ?, ?, ?)`,
        [
          JSON.stringify({
            execution: {
              engineApiEnabled: true,
              toolrunner: {
                launcher: "local",
              },
            },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "legacy execution compatibility",
          null,
        ],
      );

      const dal = new DeploymentConfigDal(container.db);
      const latest = await dal.getLatest();

      expect(latest?.config.execution.toolrunner.launcher).toBe("local");
      expect(latest?.config.execution).not.toHaveProperty("engineApiEnabled");
    } finally {
      await container.db.close();
    }
  });
});
