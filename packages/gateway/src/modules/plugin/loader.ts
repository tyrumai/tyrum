import { readFileSync, existsSync } from "node:fs";
import { join, resolve, normalize, isAbsolute } from "node:path";
import type { PluginManifestSchema as PluginManifestT } from "@tyrum/schemas";
import { PluginManifestSchema } from "@tyrum/schemas";
import type { PluginInterface } from "./types.js";

export interface LoadedPlugin {
  manifest: PluginManifestT;
  directory: string;
  loaded_at: string;
}

/**
 * Validate that the entry path doesn't escape the plugin directory.
 * Prevents path traversal attacks (e.g., `../../etc/passwd`).
 */
function validateEntryPath(directory: string, entry: string): string {
  if (isAbsolute(entry)) {
    throw new Error(`Plugin entry path must be relative, got absolute path: ${entry}`);
  }
  if (entry.includes("..")) {
    throw new Error(`Plugin entry path must not contain '..': ${entry}`);
  }
  const resolved = resolve(directory, entry);
  const normalizedDir = normalize(directory);
  if (!resolved.startsWith(normalizedDir)) {
    throw new Error(`Plugin entry path escapes plugin directory: ${entry}`);
  }
  return resolved;
}

/**
 * Load a plugin from a directory by reading its plugin.json manifest.
 * Validates the manifest using the Zod schema.
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

  const manifest = PluginManifestSchema.parse(parsed);

  // Validate entry path doesn't escape the plugin directory
  validateEntryPath(directory, manifest.entry);

  return {
    manifest,
    directory,
    loaded_at: new Date().toISOString(),
  };
}

/**
 * Dynamically import a plugin's code module.
 * The module must export a default object implementing PluginInterface.
 */
export async function loadPluginCode(
  directory: string,
  manifest: PluginManifestT,
): Promise<PluginInterface> {
  const entryPath = validateEntryPath(directory, manifest.entry);
  if (!existsSync(entryPath)) {
    throw new Error(`Plugin entry file not found: ${entryPath}`);
  }

  const module = (await import(entryPath)) as Record<string, unknown>;
  const plugin = (module["default"] ?? module) as PluginInterface;

  if (typeof plugin.onLoad !== "function") {
    throw new Error(
      `Plugin '${manifest.id}' does not export onLoad function from ${manifest.entry}`,
    );
  }

  return plugin;
}
