import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveGatewayBinPath(
  baseDir: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const candidates = [
    join(baseDir, "../../../../packages/gateway/dist/index.js"),
    join(baseDir, "../../../../packages/gateway/dist/index.mjs"),
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }

  // Fall back to the modern default so startup errors are explicit if build artifacts are missing.
  return candidates[0]!;
}
