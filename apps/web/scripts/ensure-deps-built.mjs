import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackageBuilds } from "../../../scripts/workspace-package-builds.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

const WORKSPACE_MARKER = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const PACKAGE_BUILDS = createPackageBuilds(REPO_ROOT);
const REQUIRED_ARTIFACTS = PACKAGE_BUILDS.flatMap((build) => build.outputs);

const isWindows = process.platform === "win32";

function runPnpm(args) {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.status === 0) return;
  process.exit(typeof result.status === "number" ? result.status : 1);
}

if (!existsSync(WORKSPACE_MARKER)) {
  throw new Error(`Workspace marker not found: ${WORKSPACE_MARKER}`);
}

const missing = REQUIRED_ARTIFACTS.filter((artifact) => !existsSync(artifact));
if (missing.length === 0) {
  process.exit(0);
}

for (const build of PACKAGE_BUILDS) {
  runPnpm(["--filter", build.name, "build"]);
}
