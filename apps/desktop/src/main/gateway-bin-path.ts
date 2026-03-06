import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface ResolveGatewayBinPathOptions {
  moduleDir?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  exists?: (path: string) => boolean;
}

export type GatewayBinSource = "packaged" | "staged" | "monorepo";

export interface ResolvedGatewayBin {
  path: string;
  source: GatewayBinSource;
}

export function resolveGatewayBin(options: ResolveGatewayBinPathOptions = {}): ResolvedGatewayBin {
  const moduleDir = options.moduleDir ?? import.meta.dirname;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const exists = options.exists ?? existsSync;

  const candidates: ResolvedGatewayBin[] = [];

  if (isPackaged) {
    candidates.push({
      path: join(resourcesPath, "gateway", "index.mjs"),
      source: "packaged",
    });
  }

  // Built desktop layout: apps/desktop/dist/main -> apps/desktop/dist/gateway/index.mjs
  candidates.push({
    path: join(moduleDir, "../../dist/gateway/index.mjs"),
    source: "staged",
  });

  // Monorepo fallback: apps/desktop/{src|dist}/main -> packages/gateway/dist/index.mjs
  candidates.push({
    path: join(moduleDir, "../../../../packages/gateway/dist/index.mjs"),
    source: "monorepo",
  });

  for (const candidate of candidates) {
    if (exists(candidate.path)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate embedded gateway bundle. Tried:\n- ${candidates.map((candidate) => candidate.path).join("\n- ")}`,
  );
}

export function resolveGatewayBinPath(options: ResolveGatewayBinPathOptions = {}): string {
  return resolveGatewayBin(options).path;
}
