import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export interface ResolveGatewayBinPathOptions {
  moduleDir?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
}

export function resolveGatewayBinPath(
  options: ResolveGatewayBinPathOptions = {},
): string {
  const moduleDir = options.moduleDir ?? import.meta.dirname;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const exists = options.exists ?? existsSync;

  const candidates: Array<{ path: string; requireInitMigrations?: boolean }> = [];

  const hasInitMigrations = (gatewayBinPath: string): boolean => {
    const gatewayDir = dirname(gatewayBinPath);
    return (
      exists(join(gatewayDir, "migrations", "sqlite", "001_init.sql")) ||
      exists(join(gatewayDir, "migrations", "postgres", "001_init.sql"))
    );
  };

  if (isPackaged) {
    candidates.push({ path: join(resourcesPath, "gateway", "index.mjs") });
  }

  // Built desktop layout: apps/desktop/dist/main -> apps/desktop/dist/gateway/index.mjs
  candidates.push({
    path: join(moduleDir, "../../dist/gateway/index.mjs"),
    requireInitMigrations: true,
  });

  // Monorepo fallback: apps/desktop/{src|dist}/main -> packages/gateway/dist/index.mjs
  candidates.push({
    path: join(moduleDir, "../../../../packages/gateway/dist/index.mjs"),
  });

  for (const candidate of candidates) {
    if (!exists(candidate.path)) continue;
    if (candidate.requireInitMigrations && !hasInitMigrations(candidate.path)) {
      continue;
    }
    return candidate.path;
  }

  throw new Error(
    `Unable to locate embedded gateway bundle. Tried:\n- ${candidates
      .map((candidate) => candidate.path)
      .join("\n- ")}`,
  );
}
