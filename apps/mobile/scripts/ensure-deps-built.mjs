import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

const WORKSPACE_MARKER = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const REQUIRED_ARTIFACTS = [
  resolve(REPO_ROOT, "packages/schemas/dist/index.mjs"),
  resolve(REPO_ROOT, "packages/schemas/dist/jsonschema/catalog.json"),
  resolve(REPO_ROOT, "packages/client/dist/index.mjs"),
  resolve(REPO_ROOT, "packages/operator-core/dist/index.mjs"),
  resolve(REPO_ROOT, "packages/operator-ui/dist/index.mjs"),
];

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

runPnpm(["--filter", "@tyrum/schemas", "build"]);
runPnpm(["--filter", "@tyrum/client", "build"]);
runPnpm(["--filter", "@tyrum/operator-core", "build"]);
runPnpm(["--filter", "@tyrum/operator-ui", "build"]);
