import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const LOCKFILE_PATH = resolve(REPO_ROOT, "pnpm-lock.yaml");
const ROOT_PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");

type Dependencies = Record<string, string>;

type PackageJson = {
  name?: string;
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  peerDependencies?: Dependencies;
  optionalDependencies?: Dependencies;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listWorkspacePackages(rootDir: string): string[] {
  const packageJsonPaths: string[] = [];
  const groups = [resolve(rootDir, "packages"), resolve(rootDir, "apps")];

  if (existsSync(ROOT_PACKAGE_JSON_PATH)) {
    packageJsonPaths.push(ROOT_PACKAGE_JSON_PATH);
  }

  for (const group of groups) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = resolve(group, entry.name, "package.json");
      if (existsSync(packageJsonPath)) packageJsonPaths.push(packageJsonPath);
    }
  }

  return packageJsonPaths;
}

function collectTypesNodeSpecs(pkg: PackageJson): Array<{ kind: keyof PackageJson; spec: string }> {
  const kinds: Array<keyof PackageJson> = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];

  return kinds.flatMap((kind) => {
    const record = pkg[kind];
    if (!record || typeof record !== "object") return [];
    const spec = record["@types/node"];
    if (!spec) return [];
    return [{ kind, spec }];
  });
}

describe("tooling", () => {
  it("pins @types/node to Node 24 across the workspace package.json files", () => {
    const invalidSpecs: Array<{
      packageJsonPath: string;
      name: string;
      kind: string;
      spec: string;
    }> = [];

    for (const packageJsonPath of listWorkspacePackages(REPO_ROOT)) {
      const pkg = readJson(packageJsonPath) as PackageJson;
      const name =
        pkg.name ??
        (packageJsonPath === ROOT_PACKAGE_JSON_PATH ? "(workspace root)" : packageJsonPath);
      for (const { kind, spec } of collectTypesNodeSpecs(pkg)) {
        if (!/^(?:\^|~)?24(?:\.|$)/.test(spec)) {
          invalidSpecs.push({ packageJsonPath, name, kind: String(kind), spec });
        }
      }
    }

    expect(invalidSpecs).toEqual([]);
  });

  it("does not resolve @types/node 25 in pnpm-lock.yaml", () => {
    const lockfile = readFileSync(LOCKFILE_PATH, "utf8");
    expect(lockfile).not.toMatch(/@types\/node@25\./);
  });
});
