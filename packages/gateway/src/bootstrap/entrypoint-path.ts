import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveGatewayEntrypointPath(
  moduleUrl: string = import.meta.url,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const candidates = [
    fileURLToPath(new URL("../index.mjs", moduleUrl)),
    fileURLToPath(new URL("../index.js", moduleUrl)),
    fileURLToPath(new URL("../index.ts", moduleUrl)),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1]!;
}
