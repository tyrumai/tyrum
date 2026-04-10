import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const LOCKFILE_PATH = resolve(REPO_ROOT, "pnpm-lock.yaml");
const ROOT_PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const AXIOS_PATCHED_VERSION = "1.15.0";

type RootPackageJson = {
  pnpm?: {
    overrides?: Record<string, string>;
  };
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("tooling", () => {
  it("pins axios to the patched release required by the audit baseline", () => {
    const pkg = readJson(ROOT_PACKAGE_JSON_PATH) as RootPackageJson;
    expect(pkg.pnpm?.overrides?.axios).toBe(AXIOS_PATCHED_VERSION);
  });

  it("does not resolve a vulnerable axios version in pnpm-lock.yaml", () => {
    const lockfile = readFileSync(LOCKFILE_PATH, "utf8");

    expect(lockfile).toContain(`axios@${AXIOS_PATCHED_VERSION}:`);
    expect(lockfile).not.toMatch(/axios@1\.(?:[0-9]|1[0-4])\./);
    expect(lockfile).not.toMatch(/axios@0\./);
  });
});
