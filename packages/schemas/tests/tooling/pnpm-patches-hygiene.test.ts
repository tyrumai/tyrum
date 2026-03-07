import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const ROOT_PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const PATCHES_DIR = resolve(REPO_ROOT, "patches");

type PnpmConfig = {
  overrides?: Record<string, string>;
  patchedDependencies?: Record<string, string>;
};

type RootPackageJson = {
  pnpm?: PnpmConfig;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isExactVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function parsePatchedDependencyKey(key: string): { name: string; version: string } {
  const atIndex = key.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === key.length - 1) {
    throw new Error(`Invalid pnpm.patchedDependencies key: ${key}`);
  }

  return { name: key.slice(0, atIndex), version: key.slice(atIndex + 1) };
}

describe("tooling", () => {
  it("does not keep pnpm patches for versions overridden elsewhere", () => {
    const pkg = readJson(ROOT_PACKAGE_JSON_PATH) as RootPackageJson;
    const overrides = pkg.pnpm?.overrides ?? {};
    const patchedDependencies = pkg.pnpm?.patchedDependencies ?? {};

    const mismatches: Array<{ key: string; overridden: string }> = [];

    for (const key of Object.keys(patchedDependencies)) {
      const { name, version } = parsePatchedDependencyKey(key);
      const overridden = overrides[name];
      if (!overridden) continue;
      if (!isExactVersion(overridden)) continue;
      if (overridden !== version) mismatches.push({ key, overridden });
    }

    expect(mismatches).toEqual([]);
  });

  it("keeps patches/ in sync with pnpm.patchedDependencies", () => {
    const pkg = readJson(ROOT_PACKAGE_JSON_PATH) as RootPackageJson;
    const patchedDependencies = pkg.pnpm?.patchedDependencies ?? {};

    const expectedPaths = Object.values(patchedDependencies).map((path) =>
      path.replaceAll("\\", "/"),
    );
    const expectedSet = new Set(expectedPaths);

    const missing: string[] = [];
    for (const path of expectedPaths) {
      if (!existsSync(resolve(REPO_ROOT, path))) missing.push(path);
    }

    const actualPaths = readdirSync(PATCHES_DIR)
      .filter((name) => name.endsWith(".patch"))
      .map((name) => `patches/${name}`);
    const actualSet = new Set(actualPaths);

    const extra = actualPaths.filter((path) => !expectedSet.has(path)).toSorted();
    const absent = expectedPaths.filter((path) => !actualSet.has(path)).toSorted();

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    expect(absent).toEqual([]);
  });
});
