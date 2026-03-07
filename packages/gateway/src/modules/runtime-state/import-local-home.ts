import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { McpServerSpec, PluginManifest, SkillManifest } from "@tyrum/schemas";
import type { ArtifactStore } from "../artifact/store.js";
import { AgentIdentityDal } from "../agent/identity-dal.js";
import { MarkdownMemoryDal } from "../agent/markdown-memory-dal.js";
import { RuntimePackageDal } from "../agent/runtime-package-dal.js";
import { loadLifecycleHooksFromHome } from "../hooks/config.js";
import { type IdentityScopeDal, DEFAULT_WORKSPACE_KEY } from "../identity/scope.js";
import type { Logger } from "../observability/logger.js";
import { PolicyBundleConfigDal } from "../policy/config-dal.js";
import { loadPolicyBundleFromFile } from "../policy/bundle-loader.js";
import { parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";
import { loadIdentity, loadSkillFromDir } from "../agent/workspace.js";
import { resolveMcpDir, resolveSkillsDir } from "../agent/home.js";
import { resolveSafeChildPath, missingRequiredManifestFields } from "../plugins/validation.js";
import { LifecycleHookConfigDal } from "../hooks/config-dal.js";
import type { SqlDb } from "../../statestore/types.js";

type AgentHome = {
  agentKey: string;
  home: string;
};

type ImportedPackageSet = {
  skills: Set<string>;
  mcpServers: Set<string>;
  plugins: Set<string>;
};

export type LocalHomeImportSummary = {
  tenantId: string;
  agents: number;
  identities: number;
  skills: number;
  mcpServers: number;
  plugins: number;
  hooks: number;
  deploymentPolicyImported: boolean;
  agentPolicies: number;
  markdownDocs: number;
};

export async function importLocalHomeToSharedState(params: {
  sourceHome: string;
  tenantId: string;
  identityScopeDal: IdentityScopeDal;
  artifactStore: ArtifactStore;
  db: SqlDb;
  logger?: Pick<Logger, "warn">;
  createdBy?: unknown;
  reason?: string;
}): Promise<LocalHomeImportSummary> {
  const agentIdentityDal = new AgentIdentityDal(params.db);
  const runtimePackageDal = new RuntimePackageDal(params.db);
  const markdownMemoryDal = new MarkdownMemoryDal(params.db);
  const hooksDal = new LifecycleHookConfigDal(params.db);
  const policyBundleDal = new PolicyBundleConfigDal(params.db);

  const tenantId = params.tenantId.trim();
  const agentHomes = await listAgentHomes(params.sourceHome);
  const imported: ImportedPackageSet = {
    skills: new Set<string>(),
    mcpServers: new Set<string>(),
    plugins: new Set<string>(),
  };

  const summary: LocalHomeImportSummary = {
    tenantId,
    agents: 0,
    identities: 0,
    skills: 0,
    mcpServers: 0,
    plugins: 0,
    hooks: 0,
    deploymentPolicyImported: false,
    agentPolicies: 0,
    markdownDocs: 0,
  };

  for (const agentHome of agentHomes) {
    const agentId = await params.identityScopeDal.ensureAgentId(tenantId, agentHome.agentKey);
    const workspaceId = await params.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await params.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
    summary.agents += 1;

    if (await pathExists(join(agentHome.home, "IDENTITY.md"))) {
      const identity = await loadIdentity(agentHome.home);
      await agentIdentityDal.set({
        tenantId,
        agentId,
        identity,
        createdBy: params.createdBy,
        reason: params.reason,
      });
      summary.identities += 1;
    }

    summary.skills += await importSkills({
      sourceHome: agentHome.home,
      tenantId,
      runtimePackageDal,
      importedKeys: imported.skills,
      createdBy: params.createdBy,
      reason: params.reason,
      logger: params.logger,
    });
    summary.mcpServers += await importMcpServers({
      sourceHome: agentHome.home,
      tenantId,
      runtimePackageDal,
      importedKeys: imported.mcpServers,
      createdBy: params.createdBy,
      reason: params.reason,
      logger: params.logger,
    });
    summary.markdownDocs += await importMarkdownMemory({
      sourceHome: agentHome.home,
      tenantId,
      agentId,
      markdownMemoryDal,
    });

    const policyBundle = await loadLocalPolicyBundle(agentHome.home);
    if (policyBundle) {
      if (agentHome.agentKey === "default") {
        await policyBundleDal.set({
          scope: { tenantId, scopeKind: "deployment" },
          bundle: policyBundle,
          createdBy: params.createdBy,
          reason: params.reason,
        });
        summary.deploymentPolicyImported = true;
      } else {
        await policyBundleDal.set({
          scope: { tenantId, scopeKind: "agent", agentId },
          bundle: policyBundle,
          createdBy: params.createdBy,
          reason: params.reason,
        });
        summary.agentPolicies += 1;
      }
    }
  }

  const hooks = await loadLifecycleHooksFromHome(params.sourceHome, params.logger);
  if (hooks.length > 0) {
    await hooksDal.set({
      tenantId,
      hooks,
      createdBy: params.createdBy,
      reason: params.reason,
    });
    summary.hooks = hooks.length;
  }

  summary.plugins = await importPlugins({
    sourceHome: params.sourceHome,
    tenantId,
    artifactStore: params.artifactStore,
    runtimePackageDal,
    importedKeys: imported.plugins,
    createdBy: params.createdBy,
    reason: params.reason,
    logger: params.logger,
  });

  return summary;
}

async function listAgentHomes(sourceHome: string): Promise<AgentHome[]> {
  const homes: AgentHome[] = [{ agentKey: "default", home: sourceHome }];
  const agentsDir = join(sourceHome, "agents");
  let entries: Dirent<string>[];
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    // Intentional: agent subdirectories are optional in a local home.
    return homes;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    homes.push({
      agentKey: entry.name,
      home: join(agentsDir, entry.name),
    });
  }
  return homes;
}

async function importSkills(params: {
  sourceHome: string;
  tenantId: string;
  runtimePackageDal: RuntimePackageDal;
  importedKeys: Set<string>;
  createdBy?: unknown;
  reason?: string;
  logger?: Pick<Logger, "warn">;
}): Promise<number> {
  const skillsDir = resolveSkillsDir(params.sourceHome);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    // Intentional: importing should skip homes without a skills directory.
    return 0;
  }

  let importedCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (params.importedKeys.has(entry.name)) continue;
    const manifest = await loadSkillFromDir(
      skillsDir,
      entry.name,
      "workspace",
      params.logger as never,
    );
    if (!manifest) continue;
    params.importedKeys.add(entry.name);
    await params.runtimePackageDal.set({
      tenantId: params.tenantId,
      packageKind: "skill",
      packageKey: entry.name,
      packageData: {
        meta: manifest.meta,
        body: manifest.body,
      } satisfies SkillManifest,
      createdBy: params.createdBy,
      reason: params.reason,
    });
    importedCount += 1;
  }

  return importedCount;
}

async function importMcpServers(params: {
  sourceHome: string;
  tenantId: string;
  runtimePackageDal: RuntimePackageDal;
  importedKeys: Set<string>;
  createdBy?: unknown;
  reason?: string;
  logger?: Pick<Logger, "warn">;
}): Promise<number> {
  const mcpDir = resolveMcpDir(params.sourceHome);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(mcpDir, { withFileTypes: true });
  } catch {
    // Intentional: importing should skip homes without an mcp directory.
    return 0;
  }

  let importedCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (params.importedKeys.has(entry.name)) continue;
    const spec = await loadMcpServerSpec(join(mcpDir, entry.name), entry.name, params.logger);
    if (!spec) continue;
    params.importedKeys.add(entry.name);
    await params.runtimePackageDal.set({
      tenantId: params.tenantId,
      packageKind: "mcp",
      packageKey: entry.name,
      packageData: spec satisfies McpServerSpec,
      createdBy: params.createdBy,
      reason: params.reason,
    });
    importedCount += 1;
  }

  return importedCount;
}

async function importMarkdownMemory(params: {
  sourceHome: string;
  tenantId: string;
  agentId: string;
  markdownMemoryDal: MarkdownMemoryDal;
}): Promise<number> {
  const memoryDir = join(params.sourceHome, "memory");
  let entries: Dirent<string>[];
  try {
    entries = await readdir(memoryDir, { withFileTypes: true });
  } catch {
    // Intentional: importing should skip homes without markdown memory files.
    return 0;
  }

  let importedCount = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "MEMORY.md") {
      const content = await readFile(join(memoryDir, entry.name), "utf-8");
      await params.markdownMemoryDal.putDoc({
        tenantId: params.tenantId,
        agentId: params.agentId,
        docKind: "core",
        docKey: "MEMORY",
        content,
      });
      importedCount += 1;
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) continue;
    const content = await readFile(join(memoryDir, entry.name), "utf-8");
    await params.markdownMemoryDal.putDoc({
      tenantId: params.tenantId,
      agentId: params.agentId,
      docKind: "daily",
      docKey: entry.name.slice(0, -3),
      content,
    });
    importedCount += 1;
  }

  return importedCount;
}

async function importPlugins(params: {
  sourceHome: string;
  tenantId: string;
  artifactStore: ArtifactStore;
  runtimePackageDal: RuntimePackageDal;
  importedKeys: Set<string>;
  createdBy?: unknown;
  reason?: string;
  logger?: Pick<Logger, "warn">;
}): Promise<number> {
  const pluginsRoot = join(params.sourceHome, "plugins");
  let entries: Dirent<string>[];
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true });
  } catch {
    // Intentional: importing should skip homes without a plugins directory.
    return 0;
  }

  let importedCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = join(pluginsRoot, entry.name);
    const manifest = await loadPluginManifestFromDir(pluginDir, params.logger);
    if (!manifest) continue;
    if (params.importedKeys.has(manifest.id)) continue;

    const bundle = await buildPluginBundle(pluginDir);
    const artifact = await params.artifactStore.put({
      kind: "file",
      mime_type: "application/json",
      body: Buffer.from(JSON.stringify(bundle), "utf-8"),
      labels: ["plugin", "shared_import"],
      metadata: {
        format: bundle.format,
        plugin_id: manifest.id,
        source_dir: pluginDir,
      },
    });

    params.importedKeys.add(manifest.id);
    await params.runtimePackageDal.set({
      tenantId: params.tenantId,
      packageKind: "plugin",
      packageKey: manifest.id,
      packageData: manifest satisfies PluginManifest,
      artifactId: artifact.artifact_id,
      createdBy: params.createdBy,
      reason: params.reason,
    });
    importedCount += 1;
  }

  return importedCount;
}

async function loadMcpServerSpec(
  serverDir: string,
  serverId: string,
  logger?: Pick<Logger, "warn">,
): Promise<McpServerSpec | undefined> {
  const serverPath = join(serverDir, "server.yml");
  try {
    const contents = await readFile(serverPath, "utf-8");
    const parsed = parseJsonOrYaml(contents, serverPath);
    let spec = McpServerSpec.parse(parsed);
    if (spec.id !== serverId) {
      spec = { ...spec, id: serverId };
    }
    if (spec.transport === "stdio" && spec.cwd && !spec.cwd.startsWith("/")) {
      spec = { ...spec, cwd: join(serverDir, spec.cwd) };
    } else if (spec.transport === "stdio" && !spec.cwd) {
      spec = { ...spec, cwd: serverDir };
    }
    return spec;
  } catch (err) {
    logger?.warn("mcp.server_spec_import_failed", {
      server_id: serverId,
      path: serverPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

async function loadPluginManifestFromDir(
  pluginDir: string,
  logger?: Pick<Logger, "warn">,
): Promise<PluginManifest | undefined> {
  for (const fileName of ["plugin.yml", "plugin.yaml", "plugin.json"]) {
    const manifestPath = join(pluginDir, fileName);
    try {
      const raw = await readFile(manifestPath, "utf-8");
      const parsed = parseJsonOrYaml(raw, manifestPath);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("manifest must be an object");
      }
      const missing = missingRequiredManifestFields(parsed as Record<string, unknown>);
      if (missing.length > 0) {
        throw new Error(`missing required plugin field(s): ${missing.join(", ")}`);
      }
      return PluginManifest.parse(parsed);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: string }).code
          : undefined;
      if (code === "ENOENT") continue;
      logger?.warn("plugins.import_manifest_failed", {
        source_dir: pluginDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  logger?.warn("plugins.import_manifest_failed", {
    source_dir: pluginDir,
    error: "missing plugin manifest",
  });
  return undefined;
}

async function buildPluginBundle(pluginDir: string): Promise<{
  format: "tyrum.plugin.bundle.v1";
  files: Array<{ path: string; content_base64: string }>;
}> {
  const files: Array<{ path: string; content_base64: string }> = [];
  await walkFiles(pluginDir, "", files);
  return {
    format: "tyrum.plugin.bundle.v1",
    files,
  };
}

async function walkFiles(
  rootDir: string,
  relativeDir: string,
  files: Array<{ path: string; content_base64: string }>,
): Promise<void> {
  const dirPath = relativeDir ? join(rootDir, relativeDir) : rootDir;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`plugin import does not support symlinks: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      await walkFiles(rootDir, relativePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const absolutePath = resolveSafeChildPath(rootDir, relativePath);
    const content = await readFile(absolutePath);
    files.push({
      path: relativePath.replace(/\\/g, "/"),
      content_base64: content.toString("base64"),
    });
  }
}

async function loadLocalPolicyBundle(home: string) {
  for (const fileName of ["policy.yml", "policy.yaml", "policy.json"]) {
    const path = join(home, fileName);
    if (!(await pathExists(path))) continue;
    return await loadPolicyBundleFromFile(path);
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    // Intentional: policy file discovery probes optional local files.
    return false;
  }
}
