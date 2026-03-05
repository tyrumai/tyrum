import { existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveGatewayEntrypointPath(
  processArgv1: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const currentProcessEntrypoint = processArgv1?.trim();
  if (currentProcessEntrypoint) {
    const filename = basename(currentProcessEntrypoint);
    if (
      (filename === "index.mjs" || filename === "index.js" || filename === "index.ts") &&
      fileExists(currentProcessEntrypoint)
    ) {
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
