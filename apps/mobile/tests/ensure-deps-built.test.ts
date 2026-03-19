import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPackageBuilds } from "../../../scripts/workspace-package-builds.mjs";

describe("createPackageBuilds", () => {
  it("treats upstream dist outputs as downstream freshness inputs", () => {
    const repoRoot = resolve(process.cwd(), "fixture-repo");
    const buildsByName = new Map(createPackageBuilds(repoRoot).map((build) => [build.name, build]));

    expect(buildsByName.get("@tyrum/transport-sdk")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "packages/contracts/dist/index.mjs"),
        resolve(repoRoot, "packages/contracts/dist/index.d.ts"),
        resolve(repoRoot, "packages/contracts/dist/jsonschema/catalog.json"),
      ]),
    );

    expect(buildsByName.get("@tyrum/client")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "packages/transport-sdk/dist/index.mjs"),
        resolve(repoRoot, "packages/contracts/dist/index.mjs"),
        resolve(repoRoot, "packages/contracts/dist/index.d.ts"),
        resolve(repoRoot, "packages/contracts/dist/jsonschema/catalog.json"),
      ]),
    );

    expect(buildsByName.get("@tyrum/operator-core")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "packages/transport-sdk/dist/index.mjs"),
        resolve(repoRoot, "packages/client/dist/index.mjs"),
        resolve(repoRoot, "packages/contracts/dist/index.mjs"),
      ]),
    );

    expect(buildsByName.get("@tyrum/operator-ui")?.inputs).toEqual(
      expect.arrayContaining([
        resolve(repoRoot, "packages/transport-sdk/dist/index.mjs"),
        resolve(repoRoot, "packages/client/dist/index.mjs"),
        resolve(repoRoot, "packages/operator-core/dist/index.mjs"),
        resolve(repoRoot, "packages/contracts/dist/index.mjs"),
      ]),
    );
  });
});
