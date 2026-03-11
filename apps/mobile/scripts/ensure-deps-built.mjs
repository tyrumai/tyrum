import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

const WORKSPACE_MARKER = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const PACKAGE_BUILDS = [
  {
    name: "@tyrum/schemas",
    inputs: [
      resolve(REPO_ROOT, "packages/schemas/package.json"),
      resolve(REPO_ROOT, "packages/schemas/tsconfig.json"),
      resolve(REPO_ROOT, "packages/schemas/src"),
      resolve(REPO_ROOT, "packages/schemas/scripts"),
    ],
    outputs: [
      resolve(REPO_ROOT, "packages/schemas/dist/index.mjs"),
      resolve(REPO_ROOT, "packages/schemas/dist/index.d.ts"),
      resolve(REPO_ROOT, "packages/schemas/dist/jsonschema/catalog.json"),
    ],
  },
  {
    name: "@tyrum/client",
    inputs: [
      resolve(REPO_ROOT, "packages/client/package.json"),
      resolve(REPO_ROOT, "packages/client/tsconfig.json"),
      resolve(REPO_ROOT, "packages/client/src"),
    ],
    outputs: [resolve(REPO_ROOT, "packages/client/dist/index.mjs")],
  },
  {
    name: "@tyrum/operator-core",
    inputs: [
      resolve(REPO_ROOT, "packages/operator-core/package.json"),
      resolve(REPO_ROOT, "packages/operator-core/tsconfig.json"),
      resolve(REPO_ROOT, "packages/operator-core/src"),
    ],
    outputs: [resolve(REPO_ROOT, "packages/operator-core/dist/index.mjs")],
  },
  {
    name: "@tyrum/operator-ui",
    inputs: [
      resolve(REPO_ROOT, "packages/operator-ui/package.json"),
      resolve(REPO_ROOT, "packages/operator-ui/tsconfig.json"),
      resolve(REPO_ROOT, "packages/operator-ui/src"),
    ],
    outputs: [
      resolve(REPO_ROOT, "packages/operator-ui/dist/index.mjs"),
      resolve(REPO_ROOT, "packages/operator-ui/dist/index.d.mts"),
    ],
  },
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

function latestModifiedAt(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);
  if (stats.isFile()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(latest, latestModifiedAt(resolve(targetPath, entry.name)));
  }
  return latest;
}

function earliestModifiedAt(paths) {
  let earliest = Number.POSITIVE_INFINITY;
  for (const outputPath of paths) {
    if (!existsSync(outputPath)) {
      return 0;
    }
    earliest = Math.min(earliest, statSync(outputPath).mtimeMs);
  }
  return earliest;
}

if (!existsSync(WORKSPACE_MARKER)) {
  throw new Error(`Workspace marker not found: ${WORKSPACE_MARKER}`);
}

for (const build of PACKAGE_BUILDS) {
  const newestInput = Math.max(...build.inputs.map((inputPath) => latestModifiedAt(inputPath)));
  const oldestOutput = earliestModifiedAt(build.outputs);
  if (oldestOutput >= newestInput) {
    continue;
  }
  runPnpm(["--filter", build.name, "build"]);
}
