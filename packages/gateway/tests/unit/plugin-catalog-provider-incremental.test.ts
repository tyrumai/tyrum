import { afterEach, describe, expect, it } from "vitest";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PluginManifest } from "@tyrum/contracts";
import { createContainer } from "../../src/container.js";
import { RuntimePackageDal } from "../../src/modules/agent/runtime-package-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createPluginCatalogProvider } from "../../src/modules/plugins/catalog-provider.js";
import { createEchoPluginHome, createSilentLogger } from "./plugin-registry.test-support.js";
import { pluginEntryModule } from "./plugin-registry.fixtures.test-support.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";

function sharedManifest(pluginId: string) {
  return PluginManifest.parse({
    id: pluginId,
    name: pluginId,
    version: "0.0.1",
    entry: "index.mjs",
    contributes: {
      tools: [`plugin.${pluginId}.echo`],
      commands: [pluginId],
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

describe("PluginCatalogProvider incremental tenant materialization", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("preserves unchanged tenant plugin directories when one revision changes", async () => {
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
      const dal = new RuntimePackageDal(container.db);
      const echoArtifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule("echo"), "utf-8"),
      });
      const helperArtifact = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(pluginEntryModule("helper"), "utf-8"),
      });
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedManifest("echo"),
        artifactId: echoArtifact.artifact_id,
        createdBy: { kind: "test" },
      });
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "helper",
        packageData: sharedManifest("helper"),
        artifactId: helperArtifact.artifact_id,
        createdBy: { kind: "test" },
      });

      provider = createPluginCatalogProvider({
        home,
        userHome: home,
        logger: createSilentLogger(),
        container,
      });

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toHaveLength(2);

      const cacheRoot = await (provider as unknown as { cacheRootPromise?: Promise<string> })
        .cacheRootPromise;
      const tenantRoot = join(cacheRoot!, DEFAULT_TENANT_ID);
      const helperDir = join(tenantRoot, "helper-2");
      const markerPath = join(helperDir, "marker.txt");
      await writeFile(markerPath, "persist", "utf-8");
      const helperStatsBefore = await stat(helperDir);

      const echoArtifactV2 = await container.artifactStore.put({
        kind: "file",
        mime_type: "text/javascript",
        body: Buffer.from(`${pluginEntryModule()}\n// v2`, "utf-8"),
      });
      await dal.set({
        tenantId: DEFAULT_TENANT_ID,
        packageKind: "plugin",
        packageKey: "echo",
        packageData: sharedManifest("echo"),
        artifactId: echoArtifactV2.artifact_id,
        createdBy: { kind: "test" },
      });

      expect((await provider.loadTenantRegistry(DEFAULT_TENANT_ID)).list()).toHaveLength(2);

      const helperStatsAfter = await stat(helperDir);
      const tenantDirs = await readdir(tenantRoot);
      expect(await stat(markerPath)).toBeTruthy();
      expect(helperStatsAfter.ino).toBe(helperStatsBefore.ino);
      expect(tenantDirs).toContain("helper-2");
      expect(tenantDirs).toContain("echo-3");
      expect(tenantDirs).not.toContain("echo-1");
    } finally {
      await provider?.shutdown();
      await container.db.close();
    }
  });
});
