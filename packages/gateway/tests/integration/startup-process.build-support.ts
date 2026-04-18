import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function missingBuildOutputs(outputPaths: readonly string[]): string[] {
  return outputPaths.filter((outputPath) => !existsSync(outputPath));
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

export function allBuildOutputsExist(outputPaths: readonly string[]): boolean {
  return missingBuildOutputs(outputPaths).length === 0;
}

export function earliestBuildOutputMtime(outputPaths: readonly string[]): number {
  return Math.min(...outputPaths.map((outputPath) => statSync(outputPath).mtimeMs));
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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function formatWorkspaceBuildFailure(
  prefix: string,
  result: ReturnType<typeof spawnSync>,
  requiredOutputs: readonly string[],
): string {
  const missingOutputs = missingBuildOutputs(requiredOutputs);
  const missingOutputsMessage =
    missingOutputs.length === 0 ? undefined : `missing build outputs: ${missingOutputs.join(", ")}`;
  return [formatBuildFailure(prefix, result), missingOutputsMessage].filter(Boolean).join("\n");
}

export function waitForBuildOutputs(outputPaths: readonly string[], timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (allBuildOutputsExist(outputPaths)) return true;
    sleepSync(200);
  }
  return allBuildOutputsExist(outputPaths);
}

export function isModuleNotFoundForAnyPath(
  message: string,
  pathSnippets: readonly string[],
): boolean {
  return (
    message.includes("ERR_MODULE_NOT_FOUND") &&
    pathSnippets.some((snippet) => message.includes(snippet))
  );
}

export function workspaceBuildIsStale(params: {
  outputPaths: readonly string[];
  srcDir: string;
  watchedFiles?: readonly string[];
}): boolean {
  if (!allBuildOutputsExist(params.outputPaths)) return true;

  const outputMtime = earliestBuildOutputMtime(params.outputPaths);

  if (existsSync(params.srcDir) && outputMtime < latestMtimeInDir(params.srcDir)) {
    return true;
  }

  for (const watchedFile of params.watchedFiles ?? []) {
    if (existsSync(watchedFile) && outputMtime < statSync(watchedFile).mtimeMs) {
      return true;
    }
  }

  return false;
}
