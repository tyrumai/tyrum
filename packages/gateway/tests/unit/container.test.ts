import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, createContainerAsync } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("createContainer", () => {
  it("returns a container synchronously for SQLite configs", async () => {
    const container = createContainer({ dbPath: ":memory:", migrationsDir });

    const maybeThen = (container as unknown as { then?: unknown }).then;
    expect(maybeThen).toBeUndefined();
    expect(container.config.dbPath).toBe(":memory:");

    await container.db.close();
  });

  it("exposes the resolved gateway config when provided", async () => {
    const gatewayConfig = loadConfig({ GATEWAY_TOKEN: "test-token" });
    const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

    expect(container.gatewayConfig?.auth.token).toBe("test-token");

    await container.db.close();
  });

  it("throws for Postgres configs with guidance", () => {
    expect(() =>
      createContainer({
        dbPath: "postgres://user:pass@localhost:5432/db",
        migrationsDir,
      }),
    ).toThrow(/createContainerAsync/);
  });
});

describe("createContainerAsync", () => {
  it("resolves to a container", async () => {
    const container = await createContainerAsync({ dbPath: ":memory:", migrationsDir });
    expect(container.config.dbPath).toBe(":memory:");
    await container.db.close();
  });
});
