import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const mode = process.argv.slice(2)[0];
const prettierFlag = mode === "--check" ? "--check" : mode === "--write" ? "--write" : null;

if (!prettierFlag) {
  console.error("Usage: node scripts/format-changed.mjs --write|--check");
  process.exit(1);
}

function runGitNameOnly(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });

  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const changedFiles = [
  ...runGitNameOnly(["diff", "--name-only"]),
  ...runGitNameOnly(["diff", "--name-only", "--cached"]),
];

const allowedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
]);

const prettierFiles = [...new Set(changedFiles)]
  .filter((file) => existsSync(file))
  .filter((file) => {
    const dot = file.lastIndexOf(".");
    if (dot === -1) return false;
    return allowedExtensions.has(file.slice(dot));
  });

if (prettierFiles.length === 0) {
  process.exit(0);
}

const prettier = spawnSync("pnpm", ["exec", "prettier", prettierFlag, ...prettierFiles], {
  stdio: "inherit",
});

process.exit(prettier.status ?? 1);
