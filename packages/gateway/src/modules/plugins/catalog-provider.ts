import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  invalidateTenantRegistry(tenantId: string): Promise<void>;
  shutdown(): Promise<void>;
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
    }).catch((err) => {
      this.registryPromise = undefined;
      throw err;
    });
    return await this.registryPromise;
  }

  async loadTenantRegistry(_tenantId: string): Promise<PluginRegistry> {
    return await this.loadGlobalRegistry();
  }

  async invalidateTenantRegistry(_tenantId: string): Promise<void> {
    this.registryPromise = undefined;
  }

  async shutdown(): Promise<void> {}
}

class SharedPluginCatalogProvider implements PluginCatalogProvider {
  private readonly runtimePackageDal: RuntimePackageDal;
  private readonly tenantRegistryEntries = new Map<
    string,
    { fingerprint: string; promise: Promise<PluginRegistry> }
  >();
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
    }).catch((err) => {
      this.globalRegistryPromise = undefined;
      throw err;
    });
    return await this.globalRegistryPromise;
  }

  async loadTenantRegistry(tenantId: string): Promise<PluginRegistry> {
    const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID;
    const revisions = await this.runtimePackageDal.listLatest({
      tenantId: normalizedTenantId,
      packageKind: "plugin",
      enabledOnly: true,
    });
    const fingerprint = computeRevisionFingerprint(revisions);
    const cached = this.tenantRegistryEntries.get(normalizedTenantId);
    if (cached && cached.fingerprint === fingerprint) {
      return await cached.promise;
    }

    const promise = this.loadTenantRegistryUncached(normalizedTenantId, revisions).catch((err) => {
      const current = this.tenantRegistryEntries.get(normalizedTenantId);
      if (current?.promise === promise) {
        this.tenantRegistryEntries.delete(normalizedTenantId);
      }
      throw err;
    });
    this.tenantRegistryEntries.set(normalizedTenantId, { fingerprint, promise });
    return await promise;
  }

  async invalidateTenantRegistry(tenantId: string): Promise<void> {
    const normalizedTenantId = tenantId.trim() || DEFAULT_TENANT_ID;
    this.tenantRegistryEntries.delete(normalizedTenantId);

    if (!this.cacheRootPromise) {
      return;
    }

    const cacheRoot = await this.cacheRootPromise;
    await rm(join(cacheRoot, normalizedTenantId), { recursive: true, force: true });
  }

  async shutdown(): Promise<void> {
    this.tenantRegistryEntries.clear();
    this.globalRegistryPromise = undefined;
    const cacheRootPromise = this.cacheRootPromise;
    this.cacheRootPromise = undefined;
    if (!cacheRootPromise) {
      return;
    }
    await rm(await cacheRootPromise, { recursive: true, force: true }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn("plugins.shared_cache_cleanup_failed", { error: message });
    });
  }

  private async loadTenantRegistryUncached(
    tenantId: string,
    revisions: readonly RuntimePackageRevision[],
  ): Promise<PluginRegistry> {
    const sharedRoot = await this.materializeTenantPlugins(tenantId, revisions);
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

  private async materializeTenantPlugins(
    tenantId: string,
    revisions: readonly RuntimePackageRevision[],
  ): Promise<string> {
    const cacheRoot = await this.getCacheRoot();
    const tenantRoot = join(cacheRoot, tenantId);
    await mkdir(tenantRoot, { recursive: true, mode: 0o700 });

    const expectedDirs = new Set(
      revisions
        .map((revision) => resolveMaterializedPluginDirName(revision))
        .filter((dirName): dirName is string => Boolean(dirName)),
    );
    const existingEntries = await readdir(tenantRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of existingEntries) {
      if (!entry.isDirectory() || expectedDirs.has(entry.name)) continue;
      await rm(join(tenantRoot, entry.name), { recursive: true, force: true });
    }

    for (const revision of revisions) {
      const dirName = resolveMaterializedPluginDirName(revision);
      if (dirName && (await pathExists(join(tenantRoot, dirName)))) {
        continue;
      }
      await this.materializeRevision(tenantRoot, revision);
    }

    return tenantRoot;
  }

  private async materializeRevision(
    tenantRoot: string,
    revision: RuntimePackageRevision,
  ): Promise<void> {
    try {
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

      await this.writePluginPayload({
        pluginDir,
        entryPath: entry,
        artifactBody: artifact.body,
      });

      const manifestPath = await ensurePluginManifestFile(pluginDir, plugin);
      const manifestRaw = await readFile(manifestPath, "utf-8");

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
      const candidateId =
        revision.packageData &&
        typeof revision.packageData === "object" &&
        "id" in revision.packageData &&
        typeof (revision.packageData as { id?: unknown }).id === "string"
          ? (revision.packageData as { id: string }).id
          : revision.packageKey;
      await rm(
        join(tenantRoot, `${sanitizeDirSegment(candidateId)}-${String(revision.revision)}`),
        {
          recursive: true,
          force: true,
        },
      );
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

function computeRevisionFingerprint(revisions: readonly RuntimePackageRevision[]): string {
  return revisions
    .map((revision) =>
      [
        revision.packageKey,
        String(revision.revision),
        revision.packageSha256,
        revision.artifactId ?? "",
      ].join(":"),
    )
    .join("|");
}

function resolveMaterializedPluginDirName(revision: RuntimePackageRevision): string | undefined {
  try {
    const plugin = PluginManifest.parse(revision.packageData) as PluginManifestT;
    return `${sanitizeDirSegment(plugin.id)}-${String(revision.revision)}`;
  } catch {
    return undefined;
  }
}

function parseSharedPluginBundle(body: Buffer): SharedPluginBundle | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf-8")) as unknown;
  } catch {
    // Intentional: a non-JSON artifact is treated as a raw entry payload.
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
    // Intentional: missing paths are expected during lazy materialization checks.
    return false;
  }
}

async function ensurePluginManifestFile(
  pluginDir: string,
  manifest: PluginManifestT,
): Promise<string> {
  for (const fileName of ["plugin.yml", "plugin.yaml", "plugin.json"]) {
    const candidate = join(pluginDir, fileName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  const manifestPath = join(pluginDir, "plugin.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifestPath;
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
