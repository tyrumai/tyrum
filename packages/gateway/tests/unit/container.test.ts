import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, createContainerAsync } from "../../src/container.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { DeploymentConfig } from "@tyrum/contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("createContainer", () => {
  it("returns a container synchronously for SQLite configs", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );

    const maybeThen = (container as unknown as { then?: unknown }).then;
    expect(maybeThen).toBeUndefined();
    expect(container.config.dbPath).toBe(":memory:");
    expect(container.deploymentConfig).toBeTruthy();

    await container.db.close();
  });

  it("wires TelegramBot only when configured", async () => {
    const noTelegram = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );
    expect(noTelegram.telegramBot).toBeUndefined();
    await noTelegram.db.close();

    const withTelegram = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({ channels: { telegramBotToken: "bot-token" } }) },
    );
    expect(withTelegram.telegramBot).toBeTruthy();
    await withTelegram.db.close();
  });

  it("uses deployment config artifacts settings", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      {
        deploymentConfig: DeploymentConfig.parse({
          artifacts: { store: "fs", dir: "/tmp/artifacts" },
        }),
      },
    );

    expect(container.artifactStore).toBeInstanceOf(FsArtifactStore);
    await container.db.close();
  });

  it("preserves websocket backpressure settings from deployment config", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      {
        deploymentConfig: DeploymentConfig.parse({
          websocket: { maxBufferedBytes: 8192 },
        }),
      },
    );

    expect(container.deploymentConfig.websocket.maxBufferedBytes).toBe(8192);
    await container.db.close();
  });

  it("passes logStackTraces into the shared logger", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir, logStackTraces: true },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );

    container.logger.error("gateway.failed", { error: new Error("boom") });

    const record = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    const error = record["error"] as Record<string, unknown>;
    expect(error).toMatchObject({
      type: "Error",
      message: "boom",
      stack: expect.stringContaining("Error: boom"),
    });

    await container.db.close();
  });

  it("throws for Postgres configs with guidance", () => {
    expect(() =>
      createContainer(
        {
          dbPath: "postgres://user:pass@localhost:5432/db",
          migrationsDir,
        },
        { deploymentConfig: DeploymentConfig.parse({}) },
      ),
    ).toThrow(/createContainerAsync/);
  });
});

describe("createContainerAsync", () => {
  it("resolves to a container", async () => {
    const container = await createContainerAsync(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({}) },
    );
    expect(container.config.dbPath).toBe(":memory:");
    await container.db.close();
  });
});
