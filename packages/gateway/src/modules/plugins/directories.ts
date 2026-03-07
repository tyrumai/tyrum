import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PluginDirKind = "workspace" | "user" | "bundled";
export type PluginDir = { kind: PluginDirKind; path: string };

export function resolvePluginsDir(home: string): string {
  return join(home, "plugins");
}

function tryReadPackageJsonName(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && "name" in parsed
      ? typeof (parsed as { name?: unknown }).name === "string"
        ? ((parsed as { name: string }).name as string)
        : undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveBundledPluginsDir(): string {
  return resolveBundledPluginsDirFrom(dirname(fileURLToPath(import.meta.url)));
}

export function resolveBundledPluginsDirFrom(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 10; i += 1) {
    if (tryReadPackageJsonName(join(current, "package.json")) === "@tyrum/gateway") {
      return join(current, "plugins");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(startDir, "../../../plugins");
}

export function resolvePluginSearchDirs(opts: {
  home: string;
  userHome?: string;
  includeWorkspacePlugins?: boolean;
  includeUserPlugins?: boolean;
  includeBundledPlugins?: boolean;
}): PluginDir[] {
  const dirs: PluginDir[] = [];
  if (opts.includeWorkspacePlugins ?? true) {
    dirs.push({ kind: "workspace", path: resolvePluginsDir(opts.home) });
  }
  if ((opts.includeUserPlugins ?? true) && opts.userHome) {
    dirs.push({ kind: "user", path: resolvePluginsDir(opts.userHome) });
  }
  if (opts.includeBundledPlugins ?? true) {
    dirs.push({ kind: "bundled", path: resolveBundledPluginsDir() });
  }
  return dirs;
}
