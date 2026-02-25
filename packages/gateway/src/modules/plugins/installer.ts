import { PluginManifest } from "@tyrum/schemas";
import type { PluginManifest as PluginManifestT } from "@tyrum/schemas";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";
import {
  PLUGIN_LOCK_FILENAME,
  pluginIntegritySha256Hex,
  renderPluginLockFile,
  type PluginInstallInfo,
} from "./lockfile.js";
import { missingRequiredManifestFields, resolveSafeChildPath } from "./validation.js";

const SAFE_PLUGIN_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafePluginIdSegment(value: string): string {
  if (!SAFE_PLUGIN_ID_SEGMENT.test(value)) {
    throw new Error(`invalid plugin id '${value}' (expected ${String(SAFE_PLUGIN_ID_SEGMENT)})`);
  }
  return value;
}

async function loadPluginManifestFromDir(dir: string): Promise<{
  filename: string;
  raw: string;
  manifest: PluginManifestT;
}> {
  const candidates = ["plugin.yml", "plugin.yaml", "plugin.json"];
  for (const filename of candidates) {
    const path = join(dir, filename);
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseJsonOrYaml(raw, path);
    if (!isRecord(parsed)) {
      throw new Error("manifest must be an object");
    }
    const missingFields = missingRequiredManifestFields(parsed);
    if (missingFields.length > 0) {
      throw new Error(`missing required manifest field(s): ${missingFields.join(", ")}`);
    }
    return { filename, raw, manifest: PluginManifest.parse(parsed) };
  }
  throw new Error("missing plugin manifest (expected plugin.yml, plugin.yaml, or plugin.json)");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    return Boolean(
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code !== "ENOENT",
    );
  }
}

export async function installPluginFromDir(opts: { home: string; sourceDir: string }): Promise<{
  plugin_id: string;
  plugin_dir: string;
  install: PluginInstallInfo;
}> {
  const manifestFile = await loadPluginManifestFromDir(opts.sourceDir);
  const pluginId = assertSafePluginIdSegment(manifestFile.manifest.id);

  const pluginsRoot = join(opts.home, "plugins");
  await mkdir(pluginsRoot, { recursive: true });

  const pluginDir = join(pluginsRoot, pluginId);
  if (await pathExists(pluginDir)) {
    throw new Error(`plugin '${pluginId}' already exists at ${pluginDir}`);
  }

  try {
    await cp(opts.sourceDir, pluginDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    const installedManifestPath = join(pluginDir, manifestFile.filename);
    const installedManifestRaw = await readFile(installedManifestPath, "utf-8");
    const installedEntryPath = resolveSafeChildPath(pluginDir, manifestFile.manifest.entry ?? "");
    const installedEntryRaw = await readFile(installedEntryPath, "utf-8");

    const integritySha256 = pluginIntegritySha256Hex(installedManifestRaw, installedEntryRaw);
    const recordedAt = new Date().toISOString();
    const install: PluginInstallInfo = {
      pinned_version: manifestFile.manifest.version,
      integrity_sha256: integritySha256,
      recorded_at: recordedAt,
      source: { kind: "local_path", path: opts.sourceDir },
    };

    await writeFile(
      join(pluginDir, PLUGIN_LOCK_FILENAME),
      renderPluginLockFile({
        pinned_version: install.pinned_version,
        integrity_sha256: install.integrity_sha256,
        recorded_at: recordedAt,
        source: install.source,
      }),
      "utf-8",
    );

    return { plugin_id: pluginId, plugin_dir: pluginDir, install };
  } catch (err) {
    await rm(pluginDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
