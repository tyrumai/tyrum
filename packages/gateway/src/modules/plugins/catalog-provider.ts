import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PluginManifest } from "@tyrum/schemas";
import type { PluginManifest as PluginManifestT } from "@tyrum/schemas";
import type { GatewayContainer } from "../../container.js";
import { RuntimePackageDal, type RuntimePackageRevision } from "../agent/runtime-package-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { Logger } from "../observability/logger.js";
import { isSharedStateMode } from "../runtime-state/mode.js";
import {
  PLUGIN_LOCK_FILENAME,
  pluginIntegritySha256Hex,
  renderPluginLockFile,
} from "./lockfile.js";
import { type PluginDir, resolvePluginSearchDirs } from "./directories.js";
import { PluginRegistry } from "./registry.js";
import { resolveSafeChildPath } from "./validation.js";

type SharedPluginBundleFile = {
  path: string;
  content_base64: string;
};

type SharedPluginBundle = {
  format: "tyrum.plugin.bundle.v1";
  files: SharedPluginBundleFile[];
};

export interface PluginCatalogProvider {
  loadGlobalRegistry(): Promise<PluginRegistry>;
  loadTenantRegistry(tenantId: string): Promise<PluginRegistry>;
}

class LocalPluginCatalogProvider implements PluginCatalogProvider {
  private registryPromise: Promise<PluginRegistry> | undefined;

  constructor(
    private readonly opts: {
      home: string;
      userHome?: string;
      logger: Logger;
      container?: GatewayContainer;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async loadGlobalRegistry(): Promise<PluginRegistry> {
    this.registryPromise ??= PluginRegistry.load({
      home: this.opts.home,
      userHome: this.opts.userHome,
      logger: this.opts.logger,
      container: this.opts.container,
      fetchImpl: this.opts.fetchImpl,
    });
    return await this.registryPromise;
  }

  async loadTenantRegistry(_tenantId: string): Promise<PluginRegistry> {
    return await this.loadGlobalRegistry();
  }
}

class SharedPluginCatalogProvider implements PluginCatalogProvider {
  private readonly runtimePackageDal: RuntimePackageDal;
  private readonly tenantRegistryPromises = new Map<string, Promise<PluginRegistry>>();
  private globalRegistryPromise: Promise<PluginRegistry> | undefined;
  private cacheRootPromise: Promise<string> | undefined;

  constructor(
    private readonly opts: {
      home: string;
      userHome?: string;
      logger: Logger;
      container: GatewayContainer;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.runtimePackageDal = new RuntimePackageDal(opts.container.db);
  }

  async loadGlobalRegistry(): Promise<PluginRegistry> {
    this.globalRegistryPromise ??= PluginRegistry.loadFromSearchDirs({
      dirs: resolvePluginSearchDirs({
        home: this.opts.home,
        userHome: this.opts.userHome,
        includeWorkspacePlugins: false,
        includeUserPlugins: false,
        includeBundledPlugins: true,
      }),
      logger: this.opts.logger,
      container: this.opts.container,
      fetchImpl: this.opts.fetchImpl,
    });
    return await this.globalRegistryPromise;
  }

  async loadTenantRegistry(tenantId: string): Promise<PluginRegistry> {
    const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID;
    let promise = this.tenantRegistryPromises.get(normalizedTenantId);
    if (!promise) {
      promise = this.loadTenantRegistryUncached(normalizedTenantId).catch((err) => {
        this.tenantRegistryPromises.delete(normalizedTenantId);
        throw err;
      });
      this.tenantRegistryPromises.set(normalizedTenantId, promise);
    }
    return await promise;
  }

  private async loadTenantRegistryUncached(tenantId: string): Promise<PluginRegistry> {
    const sharedRoot = await this.materializeTenantPlugins(tenantId);
    const dirs: PluginDir[] = [
      { kind: "shared", path: sharedRoot },
      ...resolvePluginSearchDirs({
        home: this.opts.home,
        userHome: this.opts.userHome,
        includeWorkspacePlugins: false,
        includeUserPlugins: false,
        includeBundledPlugins: true,
      }),
    ];

    return await PluginRegistry.loadFromSearchDirs({
      dirs,
      logger: this.opts.logger,
      container: this.opts.container,
      fetchImpl: this.opts.fetchImpl,
    });
  }

  private async getCacheRoot(): Promise<string> {
    this.cacheRootPromise ??= (async () => {
      const root = join(tmpdir(), "tyrum-shared-plugin-cache", randomUUID());
      await mkdir(root, { recursive: true, mode: 0o700 });
      return root;
    })();
    return await this.cacheRootPromise;
  }

  private async materializeTenantPlugins(tenantId: string): Promise<string> {
    const cacheRoot = await this.getCacheRoot();
    const tenantRoot = join(cacheRoot, tenantId);
    await mkdir(tenantRoot, { recursive: true, mode: 0o700 });

    const revisions = await this.runtimePackageDal.listLatest({
      tenantId,
      packageKind: "plugin",
      enabledOnly: true,
    });

    for (const revision of revisions) {
      await this.materializeRevision(tenantRoot, revision);
    }

    return tenantRoot;
  }

  private async materializeRevision(
    tenantRoot: string,
    revision: RuntimePackageRevision,
  ): Promise<void> {
    const plugin = PluginManifest.parse(revision.packageData) as PluginManifestT;
    const entry = plugin.entry?.trim();
    if (!entry) {
      this.opts.logger.warn("plugins.shared_missing_entry", {
        tenant_id: revision.tenantId,
        package_key: revision.packageKey,
        revision: revision.revision,
      });
      return;
    }
    if (!revision.artifactId) {
      this.opts.logger.warn("plugins.shared_missing_artifact", {
        tenant_id: revision.tenantId,
        package_key: revision.packageKey,
        revision: revision.revision,
      });
      return;
    }

    const artifact = await this.opts.container.artifactStore.get(revision.artifactId);
    if (!artifact) {
      this.opts.logger.warn("plugins.shared_artifact_not_found", {
        tenant_id: revision.tenantId,
        package_key: revision.packageKey,
        revision: revision.revision,
        artifact_id: revision.artifactId,
      });
      return;
    }

    const dirName = `${sanitizeDirSegment(plugin.id)}-${String(revision.revision)}`;
    const pluginDir = join(tenantRoot, dirName);
    await rm(pluginDir, { recursive: true, force: true });
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });

    try {
      const manifestRaw = `${JSON.stringify(plugin, null, 2)}\n`;
      await writeFile(join(pluginDir, "plugin.json"), manifestRaw, { mode: 0o600 });

      await this.writePluginPayload({
        pluginDir,
        entryPath: entry,
        artifactBody: artifact.body,
      });

      const entryPath = resolveSafeChildPath(pluginDir, entry);
      const entryRaw = await readFile(entryPath, "utf-8");
      const lockPath = join(pluginDir, PLUGIN_LOCK_FILENAME);
      const lockExists = await pathExists(lockPath);
      if (!lockExists) {
        await writeFile(
          lockPath,
          renderPluginLockFile({
            pinned_version: plugin.version,
            integrity_sha256: pluginIntegritySha256Hex(manifestRaw, entryRaw),
            recorded_at: new Date().toISOString(),
            source: {
              kind: "shared_runtime_package",
              tenant_id: revision.tenantId,
              package_key: revision.packageKey,
              revision: revision.revision,
              artifact_id: revision.artifactId,
            },
          }),
          { mode: 0o600 },
        );
      }
    } catch (err) {
      await rm(pluginDir, { recursive: true, force: true });
      this.opts.logger.warn("plugins.shared_materialize_failed", {
        tenant_id: revision.tenantId,
        package_key: revision.packageKey,
        revision: revision.revision,
        artifact_id: revision.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async writePluginPayload(params: {
    pluginDir: string;
    entryPath: string;
    artifactBody: Buffer;
  }): Promise<void> {
    const bundle = parseSharedPluginBundle(params.artifactBody);
    if (!bundle) {
      const entryPath = resolveSafeChildPath(params.pluginDir, params.entryPath);
      await mkdir(dirname(entryPath), { recursive: true, mode: 0o700 });
      await writeFile(entryPath, params.artifactBody, { mode: 0o600 });
      return;
    }

    for (const file of bundle.files) {
      const outputPath = resolveSafeChildPath(params.pluginDir, file.path);
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
      await writeFile(outputPath, Buffer.from(file.content_base64, "base64"), { mode: 0o600 });
    }

    const entryPath = resolveSafeChildPath(params.pluginDir, params.entryPath);
    const entryStats = await stat(entryPath).catch(() => undefined);
    if (!entryStats?.isFile()) {
      throw new Error(`shared plugin bundle is missing entry file '${params.entryPath}'`);
    }
  }
}

function parseSharedPluginBundle(body: Buffer): SharedPluginBundle | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf-8")) as unknown;
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const candidate = parsed as {
    format?: unknown;
    files?: unknown;
  };
  if (candidate.format !== "tyrum.plugin.bundle.v1" || !Array.isArray(candidate.files)) {
    return undefined;
  }

  const files: SharedPluginBundleFile[] = [];
  for (const file of candidate.files) {
    if (!file || typeof file !== "object") {
      throw new Error("shared plugin bundle contains an invalid file entry");
    }
    const record = file as {
      path?: unknown;
      content_base64?: unknown;
    };
    if (typeof record.path !== "string" || record.path.trim().length === 0) {
      throw new Error("shared plugin bundle file path must be a non-empty string");
    }
    if (typeof record.content_base64 !== "string") {
      throw new Error("shared plugin bundle file content must be base64 text");
    }
    files.push({
      path: record.path,
      content_base64: record.content_base64,
    });
  }

  return {
    format: "tyrum.plugin.bundle.v1",
    files,
  };
}

function sanitizeDirSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "plugin";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createPluginCatalogProvider(opts: {
  home: string;
  userHome?: string;
  logger: Logger;
  container: GatewayContainer;
  fetchImpl?: typeof fetch;
}): PluginCatalogProvider {
  return isSharedStateMode(opts.container.deploymentConfig)
    ? new SharedPluginCatalogProvider(opts)
    : new LocalPluginCatalogProvider(opts);
}
