import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

function runGit(args, { cwd }) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function main() {
  const topLevelResult = runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
  if (!topLevelResult.ok) {
    return;
  }

  const repoRoot = topLevelResult.stdout;
  const hooksDir = join(repoRoot, ".githooks");

  if (!existsSync(hooksDir)) {
    return;
  }

  const currentHooksPath = runGit(["config", "--local", "--get", "core.hooksPath"], {
    cwd: repoRoot,
  }).stdout;

  if (currentHooksPath === ".githooks") {
    return;
  }

  for (const hookName of ["pre-commit", "pre-push"]) {
    const hookPath = join(hooksDir, hookName);
    if (!existsSync(hookPath)) {
      continue;
    }
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      // Best-effort (e.g. Windows).
    }
  }

  const setResult = runGit(["config", "--local", "core.hooksPath", ".githooks"], { cwd: repoRoot });
  if (!setResult.ok) {
    throw new Error(setResult.stderr || "Failed to set core.hooksPath");
  }

  // Intentionally quiet on success to avoid install noise.
}

main();

