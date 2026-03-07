import { afterEach, describe, expect, it, vi } from "vitest";
import { rm, stat } from "node:fs/promises";
import { PluginManifest } from "@tyrum/schemas";
import { createContainer } from "../../src/container.js";
import { RuntimePackageDal } from "../../src/modules/agent/runtime-package-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createPluginCatalogProvider } from "../../src/modules/plugins/catalog-provider.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";
import {
  createCapturingLogger,
  createEchoPluginHome,
  createSilentLogger,
  echoToolCall,
} from "./plugin-registry.test-support.js";
import { pluginEntryModule } from "./plugin-registry.fixtures.test-support.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";

function sharedEchoManifest() {
  return PluginManifest.parse({
    id: "echo",
    name: "Echo",
    version: "0.0.1",
    entry: "index.mjs",
    contributes: {
      tools: ["plugin.echo.echo"],
      commands: ["echo"],
      routes: [],
      mcp_servers: [],
    },
    permissions: {
      tools: [],
      network_egress: [],
      secrets: [],
      db: false,
    },
    config_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  });
}

describe("PluginCatalogProvider", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("loads tenant-scoped shared plugins from runtime packages and ignores TYRUM_HOME/plugins", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    try {
      const artifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule(), "utf-8"),
      });
      await new RuntimePackageDal(container.db).set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });

      const provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      const globalPlugins = await provider.loadGlobalRegistry();
      expect(globalPlugins.list().map((plugin) => plugin.id)).toEqual([]);

      const tenantPlugins = await provider.loadTenantRegistry(DEFAULT_TENANT_ID);
      expect(tenantPlugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);

      const toolResult = await tenantPlugins.executeTool(echoToolCall(home));
      expect(toolResult?.output).toBe("hi");
    } finally {
      await container.db.close();
    }
  });

  it("skips shared plugins that do not point to an artifact payload", async () => {
    const { home } = await createEchoPluginHome({ entry: null });
    cleanupPaths.push(home);

    const { logger, warnings } = createCapturingLogger();
    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    try {
      await new RuntimePackageDal(container.db).set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        createdBy: { kind: "test" },
      });

      const provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger,
        container,
      });
      const tenantPlugins = await provider.loadTenantRegistry(DEFAULT_TENANT_ID);

      expect(tenantPlugins.list()).toEqual([]);
      expect(warnings.some((entry) => entry.msg === "plugins.shared_missing_artifact")).toBe(true);
    } finally {
      await container.db.close();
    }
  });

  it("retries a failed local global registry load", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const fakeRegistry = Object.create(PluginRegistry.prototype) as PluginRegistry;
    vi.spyOn(PluginRegistry, "load")
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(fakeRegistry);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "local" },
        },
      },
    );

    try {
      const provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      await expect(provider.loadGlobalRegistry()).rejects.toThrow("transient");
      await expect(provider.loadGlobalRegistry()).resolves.toBe(fakeRegistry);
      expect(PluginRegistry.load).toHaveBeenCalledTimes(2);
    } finally {
      await container.db.close();
    }
  });

  it("retries a failed shared global registry load", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const fakeRegistry = Object.create(PluginRegistry.prototype) as PluginRegistry;
    vi.spyOn(PluginRegistry, "loadFromSearchDirs")
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(fakeRegistry);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );

    try {
      const provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      await expect(provider.loadGlobalRegistry()).rejects.toThrow("transient");
      await expect(provider.loadGlobalRegistry()).resolves.toBe(fakeRegistry);
      expect(PluginRegistry.loadFromSearchDirs).toHaveBeenCalledTimes(2);
    } finally {
      await container.db.close();
    }
  });

  it("skips invalid shared plugin manifests without blocking other tenant plugins", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const { logger, warnings } = createCapturingLogger();
    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    try {
      const artifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule(), "utf-8"),
      });
      const dal = new RuntimePackageDal(container.db);
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "broken",
        packageData: { nope: true },
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });

      const provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger,
        container,
      });

      const tenantPlugins = await provider.loadTenantRegistry(DEFAULT_TENANT_ID);
      expect(tenantPlugins.list().map((plugin) => plugin.id)).toEqual(["echo"]);
      expect(
        warnings.some(
          (entry) =>
            entry.msg === "plugins.shared_materialize_failed" &&
            entry.fields["package_key"] === "broken",
        ),
      ).toBe(true);
    } finally {
      await container.db.close();
    }
  });

  it("reloads tenant registries after invalidation and drops removed plugins", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    let provider: ReturnType<typeof createPluginCatalogProvider> | undefined;
    try {
      const artifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule(), "utf-8"),
      });
      const dal = new RuntimePackageDal(container.db);
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });

      provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toHaveLength(1);

      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        enabled: false,
        createdBy: { kind: "test" },
      });
      await provider.invalidateTenantRegistry(DEFAULT_TENANT_ID);

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toEqual([]);
    } finally {
      await provider?.shutdown();
      await container.db.close();
    }
  });

  it("refreshes cached tenant registries when shared package revisions change externally", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    let provider: ReturnType<typeof createPluginCatalogProvider> | undefined;
    try {
      const artifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule(), "utf-8"),
      });
      const dal = new RuntimePackageDal(container.db);
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });

      provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toHaveLength(1);

      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        enabled: false,
        createdBy: { kind: "other-instance" },
      });

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toEqual([]);
    } finally {
      await provider?.shutdown();
      await container.db.close();
    }
  });

  it("cleans up the shared plugin cache root on shutdown", async () => {
    const { home } = await createEchoPluginHome();
    cleanupPaths.push(home);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: home,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );
    let provider: ReturnType<typeof createPluginCatalogProvider> | undefined;
    try {
      const artifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule(), "utf-8"),
      });
      await new RuntimePackageDal(container.db).set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedEchoManifest(),
        artifactId: artifact.artifact_id,
        createdBy: { kind: "test" },
      });

      provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });
      await provider.loadTenantRegistry(DEFAULT_TENANT_ID);

      const cacheRoot = await (provider as unknown as { cacheRootPromise?: Promise<string> })
        .cacheRootPromise;
      expect(cacheRoot).toBeTruthy();
      expect((await stat(cacheRoot!)).isDirectory()).toBe(true);

      await provider.shutdown();

      await expect(stat(cacheRoot!)).rejects.toThrow();
    } finally {
      await provider?.shutdown();
      await container.db.close();
    }
  });
});
