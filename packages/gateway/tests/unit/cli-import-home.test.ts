import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeploymentConfig } from "@tyrum/schemas";
import { DeploymentConfigDal } from "../../src/modules/config/deployment-config-dal.js";

const mocks = vi.hoisted(() => ({
  ensureDatabaseDirectory: vi.fn(),
  openGatewayDb: vi.fn(),
  resolveGatewayDbPath: vi.fn((_home: string, db?: string) => db ?? ":memory:"),
  resolveGatewayHome: vi.fn((home?: string) => home ?? "/tmp/target-home"),
  resolveGatewayMigrationsDir: vi.fn(
    (_dbPath: string, migrationsDir?: string) => migrationsDir ?? "/tmp/migrations",
  ),
  importLocalHomeToSharedState: vi.fn(),
}));

vi.mock("../../src/bootstrap/config.js", () => ({
  ensureDatabaseDirectory: mocks.ensureDatabaseDirectory,
  openGatewayDb: mocks.openGatewayDb,
  resolveGatewayDbPath: mocks.resolveGatewayDbPath,
  resolveGatewayHome: mocks.resolveGatewayHome,
  resolveGatewayMigrationsDir: mocks.resolveGatewayMigrationsDir,
}));

vi.mock("../../src/modules/runtime-state/import-local-home.js", () => ({
  importLocalHomeToSharedState: mocks.importLocalHomeToSharedState,
}));

describe("runImportHome", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    mocks.ensureDatabaseDirectory.mockReset();
    mocks.openGatewayDb.mockReset();
    mocks.importLocalHomeToSharedState.mockReset();

    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("refuses plugin imports when a Postgres target still uses filesystem artifacts", async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), "tyrum-import-home-"));
    cleanupPaths.push(sourceHome);
    await mkdir(join(sourceHome, "plugins", "echo"), { recursive: true });
    await writeFile(
      join(sourceHome, "plugins", "echo", "plugin.yml"),
      ["id: echo", "name: Echo", "version: 0.0.1", "entry: index.mjs"].join("\n"),
      "utf-8",
    );

    const fakeDb = {
      kind: "postgres" as const,
      close: vi.fn(async () => undefined),
    };
    mocks.openGatewayDb.mockResolvedValue(fakeDb);
    vi.spyOn(DeploymentConfigDal.prototype, "ensureSeeded").mockResolvedValue({
      revision: 1,
      config: DeploymentConfig.parse({}),
      configSha256: "sha256",
      createdAt: new Date().toISOString(),
      createdBy: { kind: "test" },
      reason: "seed",
      revertedFromRevision: undefined,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runImportHome } = await import("../../src/bootstrap/cli-import-home.js");
    const exitCode = await runImportHome({
      source_home: sourceHome,
      db: "postgres://gateway.example/tyrum",
    });

    expect(exitCode).toBe(1);
    expect(mocks.importLocalHomeToSharedState).not.toHaveBeenCalled();
    expect(fakeDb.close).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("configure shared artifact storage before importing plugin bundles"),
    );
  });
});
