import { existsSync } from "node:fs";
import { join } from "node:path";
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

  const candidates: string[] = [];

  if (isPackaged) {
    candidates.push(join(resourcesPath, "gateway", "index.mjs"));
  }

  // Built desktop layout: apps/desktop/dist/main -> apps/desktop/dist/gateway/index.mjs
  candidates.push(join(moduleDir, "../../dist/gateway/index.mjs"));

  // Monorepo fallback: apps/desktop/{src|dist}/main -> packages/gateway/dist/index.mjs
  candidates.push(join(moduleDir, "../../../../packages/gateway/dist/index.mjs"));

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate embedded gateway bundle. Tried:\n- ${candidates.join("\n- ")}`,
  );
}
