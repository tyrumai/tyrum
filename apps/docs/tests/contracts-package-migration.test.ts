import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
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
const scannedBasenames = new Set(["Dockerfile"]);
const ignoredScanFiles = new Set(["apps/docs/tests/contracts-package-migration.test.ts"]);

function listTrackedFiles(): string[] {
  const output = execFileSync("git", ["-C", repoRoot, "ls-files", "--", ...scanRoots], {
    encoding: "utf8",
  }).trim();
  return output.length === 0 ? [] : output.split("\n").toSorted();
}

function shouldScanFile(path: string): boolean {
  if (ignoredScanFiles.has(path)) return false;
  return scannedBasenames.has(basename(path)) || scannedExtensions.has(extname(path));
}

async function listScannableTrackedFiles(): Promise<string[]> {
  const trackedFiles = listTrackedFiles().filter(shouldScanFile);
  const results = await Promise.all(
    trackedFiles.map(async (path) => {
      try {
        await access(resolve(repoRoot, path));
        return path;
      } catch {
        return undefined;
      }
    }),
  );

  return results.filter((path): path is string => path !== undefined);
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

  it("scans nested Dockerfiles for stale package references", () => {
    const scannedFiles = listTrackedFiles().filter(shouldScanFile);

    expect(scannedFiles).toContain("Dockerfile");
    expect(scannedFiles).toContain("docker/desktop-sandbox/Dockerfile");
  });

  it("uses @tyrum/contracts as the canonical contract package across tracked source and docs", async () => {
    const offenders: string[] = [];

    for (const path of await listScannableTrackedFiles()) {
      const content = await readFile(resolve(repoRoot, path), "utf8");
      if (content.includes("@tyrum/schemas") || content.includes("packages/schemas")) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
