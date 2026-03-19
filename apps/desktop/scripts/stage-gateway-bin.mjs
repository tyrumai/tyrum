import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { createElectronNativeBuildEnv } from "./gateway-native-build-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

const sourceDistDir = join(desktopRoot, "../../packages/gateway/dist");
const sourcePath = join(sourceDistDir, "index.mjs");
const migrationsSourceDir = join(desktopRoot, "../../packages/gateway/migrations");

const targetDir = join(desktopRoot, "dist/gateway");
const migrationsTargetDir = join(targetDir, "migrations");
const runtimeNodeControlDist = join(
  targetDir,
  "node_modules/@tyrum/runtime-node-control/dist/index.mjs",
);
const runtimeExecutionDist = join(
  targetDir,
  "node_modules/@tyrum/runtime-execution/dist/index.mjs",
);
const isWindows = process.platform === "win32";

if (!existsSync(sourcePath)) {
  throw new Error(
    `Gateway bundle not found at ${sourcePath}. Run "pnpm --filter @tyrum/gateway build" first.`,
  );
}

if (!existsSync(migrationsSourceDir)) {
  throw new Error(`Gateway migrations directory not found at ${migrationsSourceDir}.`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });

const pnpmCmd = isWindows ? "pnpm.cmd" : "pnpm";
const deployArgs = [
  "--config.inject-workspace-packages=true",
  "--ignore-scripts",
  "--filter",
  "@tyrum/gateway",
  "deploy",
  "--prod",
  targetDir,
];

function formatDeployFailure(result) {
  return [
    `Failed to stage gateway dependencies (pnpm deploy exit code ${String(result.status)}).`,
    result.error ? `spawn error: ${result.error.message}` : undefined,
    result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : undefined,
    result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNativeBuildFailure(prefix, result) {
  return [
    prefix,
    result.status === null ? "exit code: null" : `exit code: ${String(result.status)}`,
    result.signal ? `signal: ${String(result.signal)}` : undefined,
    result.error ? `spawn error: ${result.error.message}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveWorkspaceNodeGypScript() {
  const directNodeGyp = join(repoRoot, "node_modules/node-gyp/bin/node-gyp.js");
  if (existsSync(directNodeGyp)) return directNodeGyp;

  const pnpmStoreDir = join(repoRoot, "node_modules/.pnpm");
  for (const entry of readdirSync(pnpmStoreDir)) {
    if (!entry.startsWith("node-gyp@")) continue;
    const candidate = join(pnpmStoreDir, entry, "node_modules/node-gyp/bin/node-gyp.js");
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`Failed to locate node-gyp in workspace install under ${pnpmStoreDir}.`);
}

const deploy = spawnSync(pnpmCmd, deployArgs, {
  stdio: "pipe",
  cwd: repoRoot,
  encoding: "utf8",
  shell: isWindows,
});

if (deploy.status !== 0) {
  throw new Error(formatDeployFailure(deploy));
}

if (!existsSync(runtimeNodeControlDist)) {
  throw new Error(
    `Staged gateway dependency missing at ${runtimeNodeControlDist}. Run "pnpm --filter @tyrum/runtime-node-control build" before staging the desktop gateway bundle.`,
  );
}

if (!existsSync(runtimeExecutionDist)) {
  throw new Error(
    `Staged gateway dependency missing at ${runtimeExecutionDist}. Run "pnpm --filter @tyrum/runtime-execution build" before staging the desktop gateway bundle.`,
  );
}

// pnpm deploy may create workspace symlinks that are valid in-repo but broken
// inside a packaged app bundle. Remove the known problematic link, but only
// when it is actually a symlink (in some configurations it may be a directory).
const problematicGatewayRef = join(targetDir, "node_modules/.pnpm/node_modules/@tyrum/gateway");
try {
  if (lstatSync(problematicGatewayRef).isSymbolicLink()) {
    // Use unlink() for symlinks so we never follow the link target.
    unlinkSync(problematicGatewayRef);
  }
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? /** @type {any} */ (error).code
      : undefined;
  if (code !== "ENOENT") throw error;
}

const electronTarget = (() => {
  const proc = spawnSync(electronPath, ["-p", "process.versions.electron"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (proc.status !== 0) {
    const reason = proc.stderr?.trim() || proc.error?.message || "unknown error";
    throw new Error(`Failed to determine Electron target version: ${reason}`);
  }
  const raw = proc.stdout.trim();
  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  if (!version) {
    throw new Error(`Failed to determine Electron Node target version (got: ${raw})`);
  }
  return version;
})();

const betterSqlite3Dir = join(targetDir, "node_modules/better-sqlite3");
const betterSqlite3PackageRoot = realpathSync(betterSqlite3Dir);
const betterSqlite3Require = createRequire(join(betterSqlite3PackageRoot, "package.json"));
const prebuildInstallEntry = betterSqlite3Require.resolve("prebuild-install/bin.js");
const electronNativeBuildEnv = createElectronNativeBuildEnv(process.env);

// Prefer prebuilt binaries for Electron; fall back to node-gyp rebuild.
const prebuildInstall = spawnSync(
  process.execPath,
  [
    prebuildInstallEntry,
    "--runtime",
    "electron",
    "--target",
    electronTarget,
    "--arch",
    process.arch,
    "--platform",
    process.platform,
  ],
  {
    cwd: betterSqlite3Dir,
    env: electronNativeBuildEnv,
    stdio: "inherit",
  },
);
if (prebuildInstall.status !== 0) {
  const nodeGypScript = resolveWorkspaceNodeGypScript();
  const rebuild = spawnSync(
    process.execPath,
    [
      nodeGypScript,
      "rebuild",
      "--release",
      `--target=${electronTarget}`,
      `--arch=${process.arch}`,
      "--dist-url=https://electronjs.org/headers",
    ],
    {
      cwd: betterSqlite3Dir,
      env: electronNativeBuildEnv,
      stdio: "inherit",
    },
  );
  if (rebuild.status !== 0) {
    throw new Error(
      formatNativeBuildFailure(
        `Failed to rebuild better-sqlite3 for Electron ${electronTarget}.`,
        rebuild,
      ),
    );
  }
}

// Copy all .mjs bundle files (entry + any code-split chunks) and their source maps.
for (const file of readdirSync(sourceDistDir)) {
  if (file.endsWith(".mjs") || file.endsWith(".mjs.map")) {
    copyFileSync(join(sourceDistDir, file), join(targetDir, file));
  }
}

cpSync(migrationsSourceDir, migrationsTargetDir, { recursive: true });

console.log(`Staged embedded gateway bundle: ${sourceDistDir} -> ${targetDir}`);
