#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const args = { base: undefined, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--base" && argv[i + 1]) {
      args.base = argv[++i];
      continue;
    }
    if (token === "--verbose") {
      args.verbose = true;
      continue;
    }
  }
  return args;
}

function runGit(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...options });
}

function getRepoRoot() {
  return runGit(["rev-parse", "--show-toplevel"]).trim();
}

function resolveBaseCommit(explicitBase) {
  if (explicitBase) return explicitBase;

  // Prefer origin/main when available, otherwise fall back to main.
  for (const candidate of ["origin/main", "main"]) {
    try {
      return runGit(["merge-base", "HEAD", candidate]).trim();
    } catch {
      // try next candidate
    }
  }

  throw new Error("unable to resolve base commit (use --base <sha>)");
}

function listAddedFiles(base) {
  const diff = runGit(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`]).trim();

  return diff.length === 0 ? [] : diff.split("\n").map((l) => l.trim());
}

function isTypeScriptSourceFile(filePath) {
  if (!(filePath.endsWith(".ts") || filePath.endsWith(".tsx"))) return false;
  if (filePath.endsWith(".d.ts")) return false;
  return true;
}

function runMaxLinesGate({ repoRoot, files, verbose }) {
  const configPath = path.join(repoRoot, "scripts/oxlint-max-lines.json");

  const args = [
    "exec",
    "oxlint",
    "-c",
    configPath,
    "-D",
    "max-lines",
    "-D",
    "max-lines-per-function",
    ...files,
  ];

  if (verbose) {
    console.log(
      `[max-lines] checking ${files.length} new file(s) (max 500 lines, max 80 lines/function)`,
    );
  }

  const result = spawnSync("pnpm", args, { stdio: "inherit", cwd: repoRoot });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = getRepoRoot();
const base = resolveBaseCommit(args.base);

const files = listAddedFiles(base).filter(isTypeScriptSourceFile);
if (files.length === 0) {
  if (args.verbose) console.log("[max-lines] no added TypeScript files");
  process.exit(0);
}

process.exit(runMaxLinesGate({ repoRoot, files, verbose: args.verbose }));
