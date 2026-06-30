import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceConfigMap } from "./pnpm-workspace-config-test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const WORKSPACE_CONFIG_PATH = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const PATCHES_DIR = resolve(REPO_ROOT, "patches");

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
    const overrides = readWorkspaceConfigMap(WORKSPACE_CONFIG_PATH, "overrides");
    const patchedDependencies = readWorkspaceConfigMap(
      WORKSPACE_CONFIG_PATH,
      "patchedDependencies",
    );

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

  it("keeps patches/ in sync with workspace patchedDependencies", () => {
    const patchedDependencies = readWorkspaceConfigMap(
      WORKSPACE_CONFIG_PATH,
      "patchedDependencies",
    );

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
