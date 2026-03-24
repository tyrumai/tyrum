import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_BUILD_SPECS } from "../../../scripts/workspace-package-builds.mjs";
import {
  createWorkspaceTestBuilds,
  WORKSPACE_TEST_BUILD_SPECS,
} from "../../../scripts/workspace-test-builds.mjs";
import {
  createWorkspaceTypecheckBuilds,
  WORKSPACE_TYPECHECK_BUILD_SPECS,
} from "../../../scripts/workspace-typecheck-builds.mjs";

describe("workspace test build graph", () => {
  it("reuses shared package metadata for overlapping freshness specs", () => {
    for (const key of ["contracts", "transport-sdk", "node-sdk", "operator-app", "operator-ui"]) {
      const packageSpec = PACKAGE_BUILD_SPECS.find((spec) => spec.key === key);
      const testSpec = WORKSPACE_TEST_BUILD_SPECS.find((spec) => spec.key === key);
      if (!packageSpec || !testSpec) {
        throw new Error(`Missing shared build spec: ${key}`);
      }

      expect(testSpec.key).toBe(packageSpec.key);
      expect(testSpec.name).toBe(packageSpec.name);
      expect(testSpec.inputPaths).toEqual(packageSpec.inputPaths);
      expect(testSpec.dependencies).toEqual(packageSpec.dependencies);
    }
  });

  it("refreshes gateway and web test artifacts from a single gateway build", () => {
    const repoRoot = resolve(process.cwd(), "fixture-repo");
    const buildsByName = new Map(
      createWorkspaceTestBuilds(repoRoot).map((build) => [build.name, build]),
    );

    expect(buildsByName.has("@tyrum/web")).toBe(false);

    expect(buildsByName.get("@tyrum/gateway")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "tsconfig.base.json"),
        resolve(repoRoot, "apps/web/src"),
        resolve(repoRoot, "apps/web/public"),
        resolve(repoRoot, "packages/node-sdk/dist/browser.mjs"),
        resolve(repoRoot, "packages/operator-ui/dist/index.mjs"),
        resolve(repoRoot, "packages/operator-app/dist/index.mjs"),
      ]),
    );

    expect(buildsByName.get("@tyrum/gateway")?.outputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "packages/gateway/dist/ui/index.html"),
        resolve(repoRoot, "apps/web/dist/index.html"),
      ]),
    );
  });

  it("reuses shared package metadata for overlapping typecheck freshness specs", () => {
    for (const key of ["contracts", "transport-sdk", "node-sdk", "operator-app", "operator-ui"]) {
      const packageSpec = PACKAGE_BUILD_SPECS.find((spec) => spec.key === key);
      const typecheckSpec = WORKSPACE_TYPECHECK_BUILD_SPECS.find((spec) => spec.key === key);
      if (!packageSpec || !typecheckSpec) {
        throw new Error(`Missing shared build spec: ${key}`);
      }

      expect(typecheckSpec.key).toBe(packageSpec.key);
      expect(typecheckSpec.name).toBe(packageSpec.name);
      expect(typecheckSpec.inputPaths).toEqual(packageSpec.inputPaths);
      expect(typecheckSpec.dependencies).toEqual(packageSpec.dependencies);
    }
  });

  it("keeps typecheck freshness prep focused on package builds", () => {
    const repoRoot = resolve(process.cwd(), "fixture-repo");
    const buildsByName = new Map(
      createWorkspaceTypecheckBuilds(repoRoot).map((build) => [build.name, build]),
    );

    expect(buildsByName.has("@tyrum/gateway")).toBe(false);
    expect(buildsByName.has("@tyrum/web")).toBe(false);

    expect(buildsByName.get("@tyrum/desktop-node")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "tsconfig.base.json"),
        resolve(repoRoot, "packages/desktop-node/src"),
        resolve(repoRoot, "packages/cli-utils/dist/index.mjs"),
        resolve(repoRoot, "packages/node-sdk/dist/index.mjs"),
      ]),
    );
  });

  it("derives typecheck freshness specs from test freshness specs except for gateway", () => {
    expect(WORKSPACE_TYPECHECK_BUILD_SPECS.map((spec) => spec.key)).toEqual(
      WORKSPACE_TEST_BUILD_SPECS.filter((spec) => spec.key !== "gateway").map((spec) => spec.key),
    );
  });
});
