import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceConfigMap } from "./pnpm-workspace-config-test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const LOCKFILE_PATH = resolve(REPO_ROOT, "pnpm-lock.yaml");
const WORKSPACE_CONFIG_PATH = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const AXIOS_PATCHED_VERSION = "1.18.1";

describe("tooling", () => {
  it("pins axios to the patched release required by the audit baseline", () => {
    const overrides = readWorkspaceConfigMap(WORKSPACE_CONFIG_PATH, "overrides");
    expect(overrides.axios).toBe(AXIOS_PATCHED_VERSION);
  });

  it("does not resolve a vulnerable axios version in pnpm-lock.yaml", () => {
    const lockfile = readFileSync(LOCKFILE_PATH, "utf8");

    expect(lockfile).toContain(`axios@${AXIOS_PATCHED_VERSION}:`);
    expect(lockfile).not.toMatch(/axios@1\.(?:[0-9]|1[0-7])\./);
    expect(lockfile).not.toContain("axios@1.15.0:");
    expect(lockfile).not.toContain("axios@1.15.1:");
    expect(lockfile).not.toContain("axios@1.15.2:");
    expect(lockfile).not.toMatch(/axios@0\./);
  });
});
