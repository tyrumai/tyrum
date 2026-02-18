import { resolveGatewayBinPath as resolveGatewayBinPathCanonical } from "./gateway-bin-path.js";

export function resolveGatewayBinPath(
  baseDir: string,
  pathExists?: (path: string) => boolean,
): string {
  return resolveGatewayBinPathCanonical({
    moduleDir: baseDir,
    // Legacy resolver did not consider packaged paths.
    isPackaged: false,
    exists: pathExists,
  });
}
