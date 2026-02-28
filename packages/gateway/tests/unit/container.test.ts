import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { createContainer, createContainerAsync } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { ModelsDevRefreshLeaseDal } from "../../src/modules/models/models-dev-refresh-lease-dal.js";

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

  it("does not read telegram bot tokens from process.env", async () => {
    const prev = process.env["TELEGRAM_BOT_TOKEN"];
    process.env["TELEGRAM_BOT_TOKEN"] = "env-token";

    try {
      const gatewayConfig = loadConfig({ GATEWAY_TOKEN: "test-token" });
      const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

      expect(container.telegramBot).toBeUndefined();

      await container.db.close();
    } finally {
      if (prev === undefined) delete process.env["TELEGRAM_BOT_TOKEN"];
      else process.env["TELEGRAM_BOT_TOKEN"] = prev;
    }
  });

  it("exposes the resolved gateway config when provided", async () => {
    const gatewayConfig = loadConfig({ GATEWAY_TOKEN: "test-token" });
    const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

    expect(container.gatewayConfig?.auth.token).toBe("test-token");

    await container.db.close();
  });

  it("uses gatewayConfig artifacts settings instead of process.env", async () => {
    const prevStore = process.env["TYRUM_ARTIFACT_STORE"];
    const prevKey = process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"];
    const prevSecret = process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"];
    process.env["TYRUM_ARTIFACT_STORE"] = "s3";
    process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"] = "test";
    process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"] = "test";

    const homeDir = mkdtempSync(join(tmpdir(), "tyrum-container-home-"));

    try {
      const gatewayConfig = loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_HOME: homeDir,
        TYRUM_ARTIFACT_STORE: "fs",
      });
      const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

      expect(container.artifactStore).toBeInstanceOf(FsArtifactStore);

      await container.db.close();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
      if (prevStore === undefined) delete process.env["TYRUM_ARTIFACT_STORE"];
      else process.env["TYRUM_ARTIFACT_STORE"] = prevStore;
      if (prevKey === undefined) delete process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"];
      else process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"] = prevKey;
      if (prevSecret === undefined) delete process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"];
      else process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"] = prevSecret;
    }
  });

  it("uses gatewayConfig instanceId as models.dev lease owner", async () => {
    vi.spyOn(ModelsDevRefreshLeaseDal.prototype, "release").mockRejectedValue(new Error("boom"));

    const homeDir = mkdtempSync(join(tmpdir(), "tyrum-container-home-"));

    try {
      const gatewayConfig = loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_HOME: homeDir,
        TYRUM_INSTANCE_ID: "instance-123",
      });

      vi.stubGlobal(
        "fetch",
        (async () =>
          new Response(
            JSON.stringify({
              openai: {
                id: "openai",
                name: "OpenAI",
                env: [],
                npm: "@ai-sdk/openai",
                models: {},
              },
            }),
            { status: 200, headers: { etag: "etag" } },
          )) as unknown as typeof fetch,
      );

      const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });
      await container.modelsDev.refreshNow();

      const row = await container.db.get<{ lease_owner: string }>(
        "SELECT lease_owner FROM models_dev_refresh_leases WHERE key = ?",
        ["models.dev"],
      );
      expect(row?.lease_owner).toBe("instance-123");

      await container.db.close();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      rmSync(homeDir, { recursive: true, force: true });
    }
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
