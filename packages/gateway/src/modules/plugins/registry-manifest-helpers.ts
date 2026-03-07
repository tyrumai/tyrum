import { PluginManifest, type PluginManifest as PluginManifestT } from "@tyrum/schemas";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { isRecord, parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";
import type { Logger } from "../observability/logger.js";
import type { PluginDirKind } from "./directories.js";
import {
  parsePluginLockFile,
  pluginIntegritySha256Hex,
  PLUGIN_LOCK_FILENAME,
  type PluginInstallInfo,
} from "./lockfile.js";
import { missingRequiredManifestFields, resolveSafeChildPath } from "./validation.js";
import type {
  PluginCommandRegistration,
  PluginRegisterFn,
  PluginRegistration,
  PluginToolRegistration,
} from "./registry-types.js";
import { pathToFileURL } from "node:url";

const MANIFEST_CANDIDATES = ["plugin.yml", "plugin.yaml", "plugin.json"] as const;
const CONFIG_CANDIDATES = ["config.yml", "config.yaml", "config.json"] as const;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorCode = (err: unknown) =>
  err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
const isTrustedOwner = (uid: number, currentUid: number) => uid === currentUid || uid === 0;
const isWorldWritable = (mode: number) => (mode & 0o002) !== 0;

export const normalizePluginId = (id: string) => id.trim() || "plugin";
export const cloneManifest = (manifest: PluginManifestT) =>
  structuredClone(manifest) as PluginManifestT;

const toolIdAllowed = (manifest: PluginManifestT, toolId: string) =>
  Boolean(manifest.contributes?.tools?.includes(toolId));
const commandAllowed = (manifest: PluginManifestT, name: string) =>
  Boolean(manifest.contributes?.commands?.includes(name));

export function isWithinDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/g)[0] !== "..");
}

async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    // Intentional: missing manifest candidates are skipped during plugin discovery.
    return undefined;
  }
}

export async function loadManifestFromDir(
  dir: string,
): Promise<{ path: string; raw: string; manifest: PluginManifestT } | undefined> {
  for (const filename of MANIFEST_CANDIDATES) {
    const path = join(dir, filename),
      raw = await tryReadFile(path);
    if (!raw) continue;
    const parsed = parseJsonOrYaml(raw, path);
    if (!isRecord(parsed)) throw new Error("manifest must be an object");
    const missingFields = missingRequiredManifestFields(parsed);
    if (missingFields.length > 0)
      throw new Error(`missing required manifest field(s): ${missingFields.join(", ")}`);
    return { path, raw, manifest: PluginManifest.parse(parsed) };
  }
  return undefined;
}

export async function loadConfigFromDir(dir: string): Promise<{ path?: string; config: unknown }> {
  for (const filename of CONFIG_CANDIDATES) {
    const path = join(dir, filename),
      raw = await tryReadFile(path);
    if (raw === undefined) continue;
    try {
      return { path, config: parseJsonOrYaml(raw, path) };
    } catch (err) {
      throw new Error(`failed to parse config (${filename}): ${errorMessage(err)}`);
    }
  }
  return { config: {} };
}

export function getCurrentUid(): number | undefined {
  if (typeof process.getuid !== "function") return undefined;
  try {
    return process.getuid();
  } catch {
    // Intentional: environments without a stable uid are treated as unknown ownership.
    return undefined;
  }
}

export async function resolveSecureDir(params: {
  logger: Logger;
  event: "plugins.insecure_root_dir" | "plugins.insecure_plugin_dir";
  kind: PluginDirKind;
  path: string;
  currentUid?: number;
  rootDir?: string;
  rootRealDir?: string;
}): Promise<string | undefined> {
  const dirKey = params.rootRealDir ? "source_dir" : "root_dir";
  let realDir: string;
  try {
    realDir = await realpath(params.path);
  } catch (err) {
    params.logger.warn(params.event, {
      [dirKey]: params.path,
      kind: params.kind,
      reason: "unresolvable",
      error: errorMessage(err),
    });
    return undefined;
  }
  if (params.rootRealDir && !isWithinDir(params.rootRealDir, realDir)) {
    params.logger.warn(params.event, {
      source_dir: params.path,
      kind: params.kind,
      reason: "escapes_root",
      root_dir: params.rootDir,
      root_real_dir: params.rootRealDir,
      plugin_real_dir: realDir,
    });
    return undefined;
  }
  if (params.currentUid === undefined) return realDir;
  try {
    const dirStat = await stat(realDir);
    if (isWorldWritable(dirStat.mode)) {
      params.logger.warn(params.event, {
        [dirKey]: params.path,
        kind: params.kind,
        reason: "world_writable",
        mode: dirStat.mode,
      });
      return undefined;
    }
    if (!isTrustedOwner(dirStat.uid, params.currentUid)) {
      params.logger.warn(params.event, {
        [dirKey]: params.path,
        kind: params.kind,
        reason: "unsafe_ownership",
        uid: dirStat.uid,
        current_uid: params.currentUid,
      });
      return undefined;
    }
  } catch (err) {
    params.logger.warn(params.event, {
      [dirKey]: params.path,
      kind: params.kind,
      reason: "unstatable",
      error: errorMessage(err),
    });
    return undefined;
  }
  return realDir;
}

export async function loadPluginLock(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  manifestVersion: string;
}): Promise<PluginInstallInfo | undefined | null> {
  let lockRaw: string;
  try {
    lockRaw = await readFile(join(params.pluginDir, PLUGIN_LOCK_FILENAME), "utf-8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    params.logger.warn("plugins.lock_unreadable", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      error: errorMessage(err),
    });
    return null;
  }
  const parsedLock = parsePluginLockFile(lockRaw);
  if (!parsedLock) {
    params.logger.warn("plugins.lock_invalid", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
    });
    return null;
  }
  if (parsedLock.pinned_version !== params.manifestVersion) {
    params.logger.warn("plugins.lock_version_mismatch", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      pinned_version: parsedLock.pinned_version,
      manifest_version: params.manifestVersion,
    });
    return null;
  }
  return parsedLock;
}

export async function resolvePluginEntryPath(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  pluginRealDir: string;
  entry: string;
}): Promise<string | undefined> {
  let entryPath: string;
  try {
    entryPath = resolveSafeChildPath(params.pluginDir, params.entry);
  } catch (err) {
    params.logger.warn("plugins.invalid_entry_path", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry: params.entry,
      error: errorMessage(err),
    });
    return undefined;
  }
  try {
    const entryRealPath = await realpath(entryPath);
    if (!isWithinDir(params.pluginRealDir, entryRealPath)) {
      params.logger.warn("plugins.invalid_entry_path", {
        plugin_id: params.pluginId,
        source_dir: params.pluginDir,
        entry: params.entry,
        reason: "symlink_escape",
        entry_path: entryPath,
        entry_real_path: entryRealPath,
        plugin_real_dir: params.pluginRealDir,
      });
      return undefined;
    }
    return entryRealPath;
  } catch (err) {
    params.logger.warn("plugins.import_failed", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry_path: entryPath,
      error: errorMessage(err),
    });
    return undefined;
  }
}

export async function verifyPluginIntegrity(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  manifestRaw: string;
  entryPath: string;
  install?: PluginInstallInfo;
}): Promise<boolean> {
  if (!params.install) return true;
  const entryRaw = await tryReadFile(params.entryPath);
  if (entryRaw === undefined) {
    params.logger.warn("plugins.lock_integrity_mismatch", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      reason: "entry_unreadable",
    });
    return false;
  }
  const integritySha256 = pluginIntegritySha256Hex(params.manifestRaw, entryRaw);
  if (integritySha256 === params.install.integrity_sha256.toLowerCase()) return true;
  params.logger.warn("plugins.lock_integrity_mismatch", {
    plugin_id: params.pluginId,
    source_dir: params.pluginDir,
    pinned_version: params.install.pinned_version,
    expected_sha256: params.install.integrity_sha256,
    actual_sha256: integritySha256,
  });
  return false;
}

export async function loadRegisterFn(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  entryPath: string;
}): Promise<PluginRegisterFn | undefined> {
  try {
    const mod = (await import(pathToFileURL(params.entryPath).href)) as Record<string, unknown>,
      candidate = mod["registerPlugin"];
    return typeof candidate === "function" ? (candidate as PluginRegisterFn) : undefined;
  } catch (err) {
    params.logger.warn("plugins.import_failed", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry_path: params.entryPath,
      error: errorMessage(err),
    });
    return undefined;
  }
}

export function collectPluginRegistration(
  manifest: PluginManifestT,
  registration: PluginRegistration,
): {
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  undeclaredTools: string[];
  undeclaredCommands: string[];
  undeclaredRouter: boolean;
} {
  const tools = new Map<string, PluginToolRegistration>(),
    undeclaredTools: string[] = [];
  for (const tool of registration.tools ?? []) {
    const toolId = tool?.descriptor.id?.trim?.() ?? "";
    if (!tool?.descriptor || typeof tool.execute !== "function" || !toolId) continue;
    if (!toolIdAllowed(manifest, toolId)) undeclaredTools.push(toolId);
    else tools.set(toolId, tool);
  }
  const commands = new Map<string, PluginCommandRegistration>(),
    undeclaredCommands: string[] = [];
  for (const cmd of registration.commands ?? []) {
    const name = typeof cmd?.name === "string" ? cmd.name.trim() : "";
    if (!name || typeof cmd?.execute !== "function") continue;
    if (!commandAllowed(manifest, name)) undeclaredCommands.push(name);
    else commands.set(name, cmd);
  }
  return {
    tools,
    commands,
    undeclaredTools,
    undeclaredCommands,
    undeclaredRouter:
      Boolean(registration.router) && (manifest.contributes?.routes?.length ?? 0) === 0,
  };
}

export function parsePluginCommand(raw: string): { name: string; args: string[] } | undefined {
  const parts = raw.trim().replace(/^\//, "").trim().split(/\s+/g).filter(Boolean);
  return parts.length > 0 ? { name: parts[0]!, args: parts.slice(1) } : undefined;
}

export function selectContainerForPlugin(
  manifest: PluginManifestT,
  container?: import("../../container.js").GatewayContainer,
): import("../../container.js").GatewayContainer | undefined {
  return container && manifest.permissions?.db ? container : undefined;
}
