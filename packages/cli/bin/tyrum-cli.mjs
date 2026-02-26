#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

const workspaceMarker = resolve(repoRoot, "pnpm-workspace.yaml");
const distEntrypoint = resolve(packageRoot, "dist/index.mjs");
const srcRoot = resolve(packageRoot, "src");

const clientDistEntrypoint = resolve(repoRoot, "packages/client/dist/index.mjs");
const schemasDistEntrypoint = resolve(repoRoot, "packages/schemas/dist/index.mjs");

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function maxMtimeMsInDir(dir) {
  let max = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, maxMtimeMsInDir(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    max = Math.max(max, statSync(fullPath).mtimeMs);
  }
  return max;
}

function cliBuildIsStale() {
  if (!existsSync(distEntrypoint)) return true;

  const distMtime = statSync(distEntrypoint).mtimeMs;

  if (existsSync(srcRoot)) {
    const srcMtime = maxMtimeMsInDir(srcRoot);
    if (distMtime < srcMtime) return true;
  }

  if (!existsSync(schemasDistEntrypoint)) return true;
  const schemasMtime = statSync(schemasDistEntrypoint).mtimeMs;
  if (distMtime < schemasMtime) return true;

  if (!existsSync(clientDistEntrypoint)) return true;
  const clientMtime = statSync(clientDistEntrypoint).mtimeMs;
  if (distMtime < clientMtime) return true;

  return false;
}

function tryBuild(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function ensureWorkspaceBuild() {
  const shouldAttemptBuild = existsSync(workspaceMarker) && existsSync(srcRoot);
  if (!shouldAttemptBuild) return;
  if (!cliBuildIsStale()) return;

  const commands = [
    ["--filter", "@tyrum/schemas", "build"],
    ["--filter", "@tyrum/client", "build"],
    ["--filter", "@tyrum/cli", "build"],
  ];

  for (const args of commands) {
    const result = tryBuild(pnpmCommand(), args);
    if (result.status === 0) continue;

    const isMissingPnpm =
      result.error &&
      typeof result.error === "object" &&
      String(result.error.message || "").includes("ENOENT");

    if (isMissingPnpm) {
      const fallback = tryBuild("corepack", ["pnpm", ...args]);
      if (fallback.status === 0) continue;
      process.exit(fallback.status ?? 1);
    }

    process.exit(result.status ?? 1);
  }
}

try {
  ensureWorkspaceBuild();

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
