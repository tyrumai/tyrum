import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function maxMtimeMsInDir(dir, sourceExtensions) {
  let max = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, maxMtimeMsInDir(fullPath, sourceExtensions));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!sourceExtensions.some((extension) => entry.name.endsWith(extension))) continue;
    max = Math.max(max, statSync(fullPath).mtimeMs);
  }
  return max;
}

function isBuildStale(input) {
  if (!existsSync(input.distEntrypoint)) return true;

  const distMtime = statSync(input.distEntrypoint).mtimeMs;

  if (existsSync(input.srcRoot)) {
    const srcMtime = maxMtimeMsInDir(input.srcRoot, input.sourceExtensions);
    if (distMtime < srcMtime) return true;
  }

  for (const dependencyEntrypoint of input.dependencyEntrypoints) {
    if (!existsSync(dependencyEntrypoint)) return true;
    const dependencyMtime = statSync(dependencyEntrypoint).mtimeMs;
    if (distMtime < dependencyMtime) return true;
  }

  return false;
}

function tryBuild(repoRoot, cmd, args) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function ensureWorkspaceBuild(input) {
  const shouldAttemptBuild = existsSync(input.workspaceMarker) && existsSync(input.srcRoot);
  if (!shouldAttemptBuild) return;
  if (!isBuildStale(input)) return;

  for (const pkg of input.buildPackages) {
    const args = ["--filter", pkg, "build"];
    const result = tryBuild(input.repoRoot, pnpmCommand(), args);
    if (result.status === 0) continue;

    const isMissingPnpm =
      result.error &&
      typeof result.error === "object" &&
      String(result.error.message || "").includes("ENOENT");

    if (isMissingPnpm) {
      const fallback = tryBuild(input.repoRoot, "corepack", ["pnpm", ...args]);
      if (fallback.status === 0) continue;
      process.exit(fallback.status ?? 1);
    }

    process.exit(result.status ?? 1);
  }
}

export async function runPackageBin(input) {
  const __dirname = dirname(fileURLToPath(input.metaUrl));
  const packageRoot = resolve(__dirname, "..");
  const repoRoot = resolve(packageRoot, "../..");
  const distEntrypoint = resolve(packageRoot, "dist/index.mjs");
  const srcRoot = resolve(packageRoot, "src");
  const workspaceMarker = resolve(repoRoot, "pnpm-workspace.yaml");

  try {
    ensureWorkspaceBuild({
      repoRoot,
      distEntrypoint,
      srcRoot,
      workspaceMarker,
      buildPackages: input.buildPackages,
      dependencyEntrypoints: input.dependencyEntrypoints.map((entrypoint) =>
        resolve(repoRoot, entrypoint),
      ),
      sourceExtensions: input.sourceExtensions ?? [".ts"],
    });

    const { runCli } = await import(pathToFileURL(distEntrypoint).href);
    const code = await runCli(process.argv.slice(2));
    if (code !== 0) {
      process.exit(code);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exit(1);
  }
}
