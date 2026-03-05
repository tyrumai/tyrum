import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "../../src/container.js";
import { DeploymentConfig } from "@tyrum/schemas";
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
        defaultConfig: DeploymentConfig.parse({ execution: { engineApiEnabled: true } }),
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
        config: DeploymentConfig.parse({ execution: { engineApiEnabled: true } }),
        createdBy: { kind: "test" },
        reason: "enable engine api",
      });
      expect(updated.revision).toBeGreaterThan(seeded.revision);
      expect(updated.config.execution.engineApiEnabled).toBe(true);

      const reverted = await dal.revertToRevision({
        revision: seeded.revision,
        createdBy: { kind: "test" },
        reason: "rollback",
      });
      expect(reverted.config.execution.engineApiEnabled).toBe(false);
      expect(reverted.revertedFromRevision).toBe(seeded.revision);
    } finally {
      await container.db.close();
    }
  });
});
