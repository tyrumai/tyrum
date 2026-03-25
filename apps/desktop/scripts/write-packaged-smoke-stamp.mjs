import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGED_SMOKE_STAMP_FILENAME = ".packaged-smoke-ready";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RELEASE_DIR = resolve(__dirname, "../release");

export function resolvePackagedSmokeStampPath(releaseDir = DEFAULT_RELEASE_DIR) {
  return resolve(releaseDir, PACKAGED_SMOKE_STAMP_FILENAME);
}

export function writePackagedSmokeStamp(releaseDir = DEFAULT_RELEASE_DIR, now = new Date()) {
  if (!existsSync(releaseDir)) {
    throw new Error(`Desktop release directory not found: ${releaseDir}`);
  }

  const stampPath = resolvePackagedSmokeStampPath(releaseDir);
  writeFileSync(stampPath, `${now.toISOString()}\n`);
  return stampPath;
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  const stampPath = writePackagedSmokeStamp();
  console.log(`Wrote packaged smoke stamp: ${stampPath}`);
}
