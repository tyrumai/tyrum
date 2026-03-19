import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const scanRoots = [
  ".github",
  "apps",
  "docker",
  "docs",
  "packages",
  "scripts",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "Dockerfile",
  "README.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
] as const;
const scannedExtensions = new Set([".json", ".md", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const scannedRootFiles = new Set(["Dockerfile"]);
const ignoredScanFiles = new Set(["apps/docs/tests/contracts-package-migration.test.ts"]);

function listTrackedFiles(): string[] {
  const output = execFileSync("git", ["-C", repoRoot, "ls-files", "--", ...scanRoots], {
    encoding: "utf8",
  }).trim();
  return output.length === 0 ? [] : output.split("\n").toSorted();
}

function shouldScanFile(path: string): boolean {
  if (ignoredScanFiles.has(path)) return false;
  return scannedRootFiles.has(path) || scannedExtensions.has(extname(path));
}

describe("contracts package migration", () => {
  it("removes the legacy schemas workspace package from tracked files", () => {
    const trackedFiles = listTrackedFiles();

    expect(trackedFiles).toContain("packages/contracts/package.json");
    expect(trackedFiles.some((path) => path.startsWith("packages/schemas/"))).toBe(false);
  });

  it("scans YAML workflow files for stale package references", () => {
    const scannedFiles = listTrackedFiles().filter(shouldScanFile);

    expect(scannedFiles).toContain(".github/workflows/release.yml");
    expect(scannedFiles).toContain("pnpm-workspace.yaml");
  });

  it("uses @tyrum/contracts as the canonical contract package across tracked source and docs", async () => {
    const offenders: string[] = [];

    for (const path of listTrackedFiles().filter(shouldScanFile)) {
      const content = await readFile(resolve(repoRoot, path), "utf8");
      if (content.includes("@tyrum/schemas") || content.includes("packages/schemas")) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
