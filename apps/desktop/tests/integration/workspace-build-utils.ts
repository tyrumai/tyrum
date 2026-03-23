import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface BuildOutputFreshnessInput {
  outputPath: string;
  packageJsonPath?: string;
  tsconfigPath?: string;
  sourceDirs?: readonly string[];
}

interface EnsureWorkspaceBuildInput {
  repoRoot: string;
  filter: string;
  outputPath: string;
  failurePrefix: string;
  script?: string;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function latestMtimeInDir(rootDir: string): number {
  let latest = 0;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const mtimeMs = statSync(fullPath).mtimeMs;
      if (mtimeMs > latest) latest = mtimeMs;
    }
  }
  return latest;
}

export function buildOutputIsStale(input: BuildOutputFreshnessInput): boolean {
  if (!existsSync(input.outputPath)) return true;
  const outputMtime = statSync(input.outputPath).mtimeMs;
  if (input.packageJsonPath && existsSync(input.packageJsonPath)) {
    if (outputMtime < statSync(input.packageJsonPath).mtimeMs) return true;
  }
  if (input.tsconfigPath && existsSync(input.tsconfigPath)) {
    if (outputMtime < statSync(input.tsconfigPath).mtimeMs) return true;
  }
  for (const sourceDir of input.sourceDirs ?? []) {
    if (existsSync(sourceDir) && outputMtime < latestMtimeInDir(sourceDir)) return true;
  }
  return false;
}

function formatBuildFailure(prefix: string, result: ReturnType<typeof spawnSync>): string {
  const details = [
    prefix,
    result.error ? `spawn error: ${result.error.message}` : undefined,
    result.status === null ? "exit status: null" : `exit status: ${String(result.status)}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean);
  return details.join("\n");
}

function tryWorkspaceBuild(
  repoRoot: string,
  cmd: string,
  args: string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function waitForBuildOutputByAnotherWorker(outputPath: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(outputPath)) return true;
    sleepSync(200);
  }
  return existsSync(outputPath);
}

export function ensureWorkspaceBuild({
  repoRoot,
  filter,
  outputPath,
  failurePrefix,
  script = "build",
}: EnsureWorkspaceBuildInput): void {
  const args = ["--filter", filter, script];
  const result = tryWorkspaceBuild(repoRoot, "pnpm", args);
  if (result.status === 0 || existsSync(outputPath)) return;
  if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;

  if (result.error?.message.includes("ENOENT")) {
    const corepackResult = tryWorkspaceBuild(repoRoot, "corepack", ["pnpm", ...args]);
    if (corepackResult.status === 0 || existsSync(outputPath)) return;
    if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;
    throw new Error(formatBuildFailure(failurePrefix, corepackResult));
  }

  throw new Error(formatBuildFailure(failurePrefix, result));
}
