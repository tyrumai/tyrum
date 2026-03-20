import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";

function runPnpm(repoRoot, args) {
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
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

export function ensureBuildsFresh(repoRoot, builds) {
  const workspaceMarker = resolve(repoRoot, "pnpm-workspace.yaml");
  if (!existsSync(workspaceMarker)) {
    throw new Error(`Workspace marker not found: ${workspaceMarker}`);
  }

  for (const build of builds) {
    const newestInput = Math.max(...build.inputs.map((inputPath) => latestModifiedAt(inputPath)));
    const oldestOutput = earliestModifiedAt(build.outputs);
    if (oldestOutput >= newestInput) {
      continue;
    }
    runPnpm(repoRoot, ["--filter", build.name, "build"]);
  }
}
