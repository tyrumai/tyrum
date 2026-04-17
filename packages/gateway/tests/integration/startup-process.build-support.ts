import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

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
