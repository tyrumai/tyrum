import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function findWorkspaceRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function tryBuildWeb(repoRoot) {
  const args = ["--filter", "@tyrum/web", "build"];
  const result = spawnSync(pnpmCommand(), args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status === 0) return;

  const isMissingPnpm = result.error && String(result.error.message || "").includes("ENOENT");
  if (!isMissingPnpm) process.exit(result.status ?? 1);

  const corepackResult = spawnSync("corepack", ["pnpm", ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (corepackResult.status === 0) return;
  process.exit(corepackResult.status ?? 1);
}

async function main() {
  const repoRoot = findWorkspaceRoot(packageRoot);
  if (!repoRoot) return;

  const sourceDir = resolve(repoRoot, "apps/web/dist");
  const sourceIndex = resolve(sourceDir, "index.html");
  if (!existsSync(sourceIndex)) {
    tryBuildWeb(repoRoot);
  }

  if (!existsSync(sourceIndex)) {
    throw new Error(`Operator UI build output missing after build: ${sourceIndex}`);
  }

  const destDir = resolve(packageRoot, "dist/ui");
  await rm(destDir, { recursive: true, force: true });
  await cp(sourceDir, destDir, { recursive: true });
}

await main();
