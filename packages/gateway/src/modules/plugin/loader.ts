import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry?: string;
  capabilities?: string[];
  permissions?: string[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  directory: string;
  loaded_at: string;
}

/**
 * Load a plugin from a directory by reading its plugin.json manifest.
 */
export function loadPlugin(directory: string): LoadedPlugin {
  const manifestPath = join(directory, "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found: ${manifestPath}`);
  }

  const raw = readFileSync(manifestPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid plugin manifest JSON at ${manifestPath}`);
  }

  const manifest = validateManifest(parsed, manifestPath);

  return {
    manifest,
    directory,
    loaded_at: new Date().toISOString(),
  };
}

function validateManifest(parsed: unknown, path: string): PluginManifest {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Plugin manifest at ${path} is not an object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["id"] !== "string" || !obj["id"]) {
    throw new Error(`Plugin manifest at ${path} missing required field 'id'`);
  }
  if (typeof obj["name"] !== "string" || !obj["name"]) {
    throw new Error(`Plugin manifest at ${path} missing required field 'name'`);
  }
  if (typeof obj["version"] !== "string" || !obj["version"]) {
    throw new Error(`Plugin manifest at ${path} missing required field 'version'`);
  }
  return {
    id: obj["id"] as string,
    name: obj["name"] as string,
    version: obj["version"] as string,
    description: typeof obj["description"] === "string" ? obj["description"] : undefined,
    entry: typeof obj["entry"] === "string" ? obj["entry"] : undefined,
    capabilities: Array.isArray(obj["capabilities"]) ? (obj["capabilities"] as string[]) : undefined,
    permissions: Array.isArray(obj["permissions"]) ? (obj["permissions"] as string[]) : undefined,
  };
}
