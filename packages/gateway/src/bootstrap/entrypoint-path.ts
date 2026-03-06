import { existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const runnableEntrypoints = new Set([
  "index.mjs",
  "index.js",
  "index.ts",
  "tyrum.mjs",
  "tyrum.js",
  "tyrum.ts",
]);

export function resolveGatewayEntrypointPath(
  processArgv1: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const currentProcessEntrypoint = processArgv1?.trim();
  if (currentProcessEntrypoint) {
    const filename = basename(currentProcessEntrypoint);
    if (runnableEntrypoints.has(filename) && fileExists(currentProcessEntrypoint)) {
      return currentProcessEntrypoint;
    }
  }

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
