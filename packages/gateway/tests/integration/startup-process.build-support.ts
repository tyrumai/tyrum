import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type WorkspaceDependencyBuild = {
  failurePrefix: string;
  filter: string;
  output: string;
  packageJson: string;
  srcDir: string;
  tsconfig: string;
};

export const TRANSIENT_GATEWAY_DEPENDENCY_PATH_SNIPPETS = [
  "packages/gateway/node_modules/@tyrum/contracts/dist/",
  "packages/gateway/node_modules/@tyrum/cli-utils/dist/",
  "packages/gateway/node_modules/@tyrum/runtime-policy/dist/",
  "packages/gateway/node_modules/@tyrum/runtime-node-control/dist/",
  "packages/gateway/node_modules/@tyrum/runtime-execution/dist/",
  "packages/gateway/node_modules/@tyrum/runtime-agent/dist/",
  "packages/gateway/node_modules/@tyrum/runtime-workboard/dist/",
  "packages/runtime-policy/node_modules/@tyrum/contracts/dist/",
  "packages/runtime-node-control/node_modules/@tyrum/contracts/dist/",
  "packages/runtime-execution/node_modules/@tyrum/contracts/dist/",
  "packages/runtime-agent/node_modules/@tyrum/contracts/dist/",
  "packages/runtime-workboard/node_modules/@tyrum/contracts/dist/",
  "packages/contracts/dist/index.mjs",
  "packages/cli-utils/dist/index.mjs",
  "packages/runtime-policy/dist/index.mjs",
  "packages/runtime-node-control/dist/index.mjs",
  "packages/runtime-execution/dist/index.mjs",
  "packages/runtime-agent/dist/index.mjs",
  "packages/runtime-workboard/dist/index.mjs",
] as const;

function workspaceDependencyBuild(
  repoRoot: string,
  packageDir: string,
  packageName: string,
): WorkspaceDependencyBuild {
  return {
    filter: packageName,
    output: resolve(repoRoot, "packages", packageDir, "dist/index.mjs"),
    packageJson: resolve(repoRoot, "packages", packageDir, "package.json"),
    tsconfig: resolve(repoRoot, "packages", packageDir, "tsconfig.json"),
    srcDir: resolve(repoRoot, "packages", packageDir, "src"),
    failurePrefix: `Failed to build ${packageName} before startup test.`,
  };
}

export function createGatewayWorkspaceDependencyBuilds(
  repoRoot: string,
): readonly WorkspaceDependencyBuild[] {
  return [
    workspaceDependencyBuild(repoRoot, "cli-utils", "@tyrum/cli-utils"),
    workspaceDependencyBuild(repoRoot, "runtime-policy", "@tyrum/runtime-policy"),
    workspaceDependencyBuild(repoRoot, "runtime-node-control", "@tyrum/runtime-node-control"),
    workspaceDependencyBuild(repoRoot, "runtime-execution", "@tyrum/runtime-execution"),
    workspaceDependencyBuild(repoRoot, "runtime-agent", "@tyrum/runtime-agent"),
    workspaceDependencyBuild(repoRoot, "runtime-workboard", "@tyrum/runtime-workboard"),
  ];
}

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
