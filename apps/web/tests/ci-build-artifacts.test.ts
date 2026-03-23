import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_MANIFEST_FILENAME,
  ARTIFACT_SCHEMA_VERSION,
  computeLockfileHash,
  restoreBuildArtifact,
  stageBuildArtifact,
} from "../../../scripts/ci/build-artifacts-lib.mjs";

function writeFixtureFile(rootDir: string, relativePath: string, contents: string): void {
  const fullPath = resolve(rootDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
}

describe("CI build artifact helpers", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  function createFixtureRepo(): string {
    tempRoot = mkdtempSync(join(tmpdir(), "tyrum-ci-artifacts-"));
    writeFixtureFile(tempRoot, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    writeFixtureFile(tempRoot, "packages/gateway/dist/index.mjs", "gateway-build\n");
    writeFixtureFile(tempRoot, "apps/web/dist/index.html", "<html>web-build</html>\n");
    writeFixtureFile(tempRoot, "apps/desktop/release/unpacked/app.bin", "desktop-release\n");
    return tempRoot;
  }

  it("stages workspace dist outputs with a manifest", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/linux-workspace-builds");

    const manifest = stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "linux-workspace-builds",
      gitSha: "abc123",
      runnerOs: "Linux",
      nodeVersion: process.version,
    });

    expect(manifest.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(manifest.outputs).toEqual(["apps/web/dist", "packages/gateway/dist"]);
    expect(manifest.lockfileHash).toBe(computeLockfileHash(repoRoot));

    const storedManifest = JSON.parse(
      readFileSync(resolve(artifactDir, ARTIFACT_MANIFEST_FILENAME), "utf8"),
    ) as {
      outputs: string[];
    };
    expect(storedManifest.outputs).toEqual(manifest.outputs);
    expect(readFileSync(resolve(artifactDir, "packages/gateway/dist/index.mjs"), "utf8")).toBe(
      "gateway-build\n",
    );
  });

  it("restores staged outputs and rejects metadata mismatches", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/desktop-suite-builds");

    stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "desktop-suite-builds",
      gitSha: "abc123",
      runnerOs: "Linux",
      nodeVersion: process.version,
    });

    writeFixtureFile(repoRoot, "packages/gateway/dist/index.mjs", "stale-build\n");

    restoreBuildArtifact({
      repoRoot,
      artifactDir,
      expectedGroupName: "desktop-suite-builds",
      expectedGitSha: "abc123",
      expectedRunnerOs: "Linux",
      expectedNodeVersion: process.version,
    });
    expect(readFileSync(resolve(repoRoot, "packages/gateway/dist/index.mjs"), "utf8")).toBe(
      "gateway-build\n",
    );

    expect(() =>
      restoreBuildArtifact({
        repoRoot,
        artifactDir,
        expectedGroupName: "linux-workspace-builds",
        expectedGitSha: "abc123",
        expectedRunnerOs: "Linux",
        expectedNodeVersion: process.version,
      }),
    ).toThrow(/group mismatch/);

    expect(() =>
      restoreBuildArtifact({
        repoRoot,
        artifactDir,
        expectedGroupName: "desktop-suite-builds",
        expectedGitSha: "abc123",
        expectedRunnerOs: "Windows",
        expectedNodeVersion: process.version,
      }),
    ).toThrow(/runner OS mismatch/);
  });
});
