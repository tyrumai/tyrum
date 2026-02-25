import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const prettierFlag = mode === "--check" ? "--check" : mode === "--write" ? "--write" : null;

if (!prettierFlag) {
  console.error("Usage: node scripts/format-repo.mjs --write|--check");
  process.exit(1);
}

const trackedFilesByExtension = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.mjs",
  "*.cjs",
  "*.json",
  "*.md",
  "*.mdx",
  "*.yml",
  "*.yaml",
];

function listTrackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--", ...trackedFilesByExtension], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter(Boolean);
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

const files = listTrackedFiles();
if (files.length === 0) {
  process.exit(0);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const prettierArgs = ["exec", "prettier", prettierFlag];

for (const chunkedFiles of chunk(files, 200)) {
  const prettier = spawnSync(pnpmCommand, [...prettierArgs, ...chunkedFiles], {
    stdio: "inherit",
  });

  if (prettier.status !== 0) {
    process.exit(prettier.status ?? 1);
  }
}

process.exit(0);
