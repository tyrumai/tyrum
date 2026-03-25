import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

const BETTER_SQLITE3_NATIVE_BINDING_SEGMENTS = [
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
] as const;

function replaceAppAsarSegment(path: string): string | undefined {
  const normalizedPath = path.replaceAll("\\", "/");
  const appAsarMarker = "/app.asar/";
  const markerIndex = normalizedPath.indexOf(appAsarMarker);
  if (markerIndex === -1) {
    return undefined;
  }

  const rewrittenPath = `${normalizedPath.slice(0, markerIndex)}/app.asar.unpacked/${normalizedPath.slice(markerIndex + appAsarMarker.length)}`;
  return path.includes("\\") ? rewrittenPath.replaceAll("/", "\\") : rewrittenPath;
}

export function resolveBetterSqliteNativeBindingPath(
  options: {
    moduleDir?: string;
    exists?: (path: string) => boolean;
  } = {},
): string | undefined {
  const moduleDir = options.moduleDir ?? import.meta.dirname;
  const exists = options.exists ?? existsSync;
  const pathJoin = moduleDir.includes("\\") ? win32.join : posix.join;
  const unpackedModuleDir = replaceAppAsarSegment(moduleDir);
  if (!unpackedModuleDir) {
    return undefined;
  }

  const nativeBindingPath = pathJoin(unpackedModuleDir, ...BETTER_SQLITE3_NATIVE_BINDING_SEGMENTS);
  return exists(nativeBindingPath) ? nativeBindingPath : undefined;
}
