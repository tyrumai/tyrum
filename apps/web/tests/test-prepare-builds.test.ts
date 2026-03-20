import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceTestBuilds } from "../../../scripts/workspace-test-builds.mjs";

describe("workspace test build graph", () => {
  it("refreshes gateway and web test artifacts from a single gateway build", () => {
    const repoRoot = resolve(process.cwd(), "fixture-repo");
    const buildsByName = new Map(
      createWorkspaceTestBuilds(repoRoot).map((build) => [build.name, build]),
    );

    expect(buildsByName.has("@tyrum/web")).toBe(false);

    expect(buildsByName.get("@tyrum/gateway")?.inputs).toEqual(
      expect.arrayContaining([
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
});
