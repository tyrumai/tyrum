import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

function writeFixtureFile(
  rootDir: string,
  relativePath: string,
  contents: string,
  options?: { mode?: number },
): void {
  const fullPath = resolve(rootDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents, options);
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
    writeFixtureFile(tempRoot, "apps/desktop/release/unpacked/app.bin", "desktop-release\n", {
      mode: 0o755,
    });
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

  it("restores dist outputs behind workspace package symlinks", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/desktop-suite-builds");
    writeFixtureFile(repoRoot, "packages/contracts/dist/index.mjs", "contracts-build\n");
    mkdirSync(resolve(repoRoot, "packages/runtime-node-control/node_modules/@tyrum"), {
      recursive: true,
    });
    symlinkSync(
      "../../../contracts",
      resolve(repoRoot, "packages/runtime-node-control/node_modules/@tyrum/contracts"),
      "dir",
    );

    stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "desktop-suite-builds",
      gitSha: "abc123",
      runnerOs: "Linux",
      nodeVersion: process.version,
    });

    rmSync(resolve(repoRoot, "packages/contracts/dist"), { recursive: true, force: true });

    restoreBuildArtifact({
      repoRoot,
      artifactDir,
      expectedGroupName: "desktop-suite-builds",
      expectedGitSha: "abc123",
      expectedRunnerOs: "Linux",
      expectedNodeVersion: process.version,
    });

    expect(
      readFileSync(
        resolve(
          repoRoot,
          "packages/runtime-node-control/node_modules/@tyrum/contracts/dist/index.mjs",
        ),
        "utf8",
      ),
    ).toBe("contracts-build\n");
  });

  it("restores executable file modes after artifact downloads flatten permissions", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/desktop-suite-builds");

    stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "desktop-suite-builds",
      gitSha: "abc123",
      runnerOs: "macOS",
      nodeVersion: process.version,
    });

    const stagedExecutable = resolve(artifactDir, "apps/desktop/release/unpacked/app.bin");
    const restoredExecutable = resolve(repoRoot, "apps/desktop/release/unpacked/app.bin");

    chmodSync(stagedExecutable, 0o644);
    chmodSync(restoredExecutable, 0o600);

    restoreBuildArtifact({
      repoRoot,
      artifactDir,
      expectedGroupName: "desktop-suite-builds",
      expectedGitSha: "abc123",
      expectedRunnerOs: "macOS",
      expectedNodeVersion: process.version,
    });

    expect(statSync(restoredExecutable).mode & 0o777).toBe(0o755);
  });

  it("ignores hidden artifact paths when recording file modes", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/linux-workspace-builds");
    writeFixtureFile(
      repoRoot,
      "packages/gateway/dist/node_modules/.bin/acorn",
      "#!/usr/bin/env node\n",
      {
        mode: 0o755,
      },
    );

    const manifest = stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "linux-workspace-builds",
      gitSha: "abc123",
      runnerOs: "Linux",
      nodeVersion: process.version,
    });

    expect(Object.keys(manifest.fileModes ?? {})).not.toContain(
      "packages/gateway/dist/node_modules/.bin/acorn",
    );

    rmSync(resolve(artifactDir, "packages/gateway/dist/node_modules/.bin"), {
      recursive: true,
      force: true,
    });

    expect(() =>
      restoreBuildArtifact({
        repoRoot,
        artifactDir,
        expectedGroupName: "linux-workspace-builds",
        expectedGitSha: "abc123",
        expectedRunnerOs: "Linux",
        expectedNodeVersion: process.version,
      }),
    ).not.toThrow();
  });

  it("rejects manifest outputs that contain embedded parent-directory segments", () => {
    const repoRoot = createFixtureRepo();
    const artifactDir = resolve(repoRoot, ".ci-artifacts/linux-workspace-builds");

    stageBuildArtifact({
      repoRoot,
      artifactDir,
      groupName: "linux-workspace-builds",
      gitSha: "abc123",
      runnerOs: "Linux",
      nodeVersion: process.version,
    });

    const manifestPath = resolve(artifactDir, ARTIFACT_MANIFEST_FILENAME);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      outputs: string[];
    };
    manifest.outputs = ["packages/gateway/dist", "foo/../../etc/passwd"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() =>
      restoreBuildArtifact({
        repoRoot,
        artifactDir,
        expectedGroupName: "linux-workspace-builds",
        expectedGitSha: "abc123",
        expectedRunnerOs: "Linux",
        expectedNodeVersion: process.version,
      }),
    ).toThrow(/Invalid artifact output path/);
  });
});
