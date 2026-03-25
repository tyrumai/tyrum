import { describe, expect, it, vi } from "vitest";
import {
  ensurePackagedSmokeArtifact,
  TRUST_PACKAGED_SMOKE_ARTIFACT_ENV,
} from "./integration/packaged-smoke-artifact.js";

const PACKAGED_SMOKE_STAMP_PATH = "/tmp/release/packaged-smoke-ready.txt";
const PACKAGED_EXECUTABLE_CANDIDATES = [
  "/tmp/release/mac-arm64/Tyrum.app/Contents/MacOS/Tyrum",
  "/tmp/release/mac-universal/Tyrum.app/Contents/MacOS/Tyrum",
] as const;
const CURRENT_BUILD_ARTIFACT_PATHS = [
  "/tmp/packages/desktop-node/dist/index.mjs",
  "/tmp/apps/desktop/dist/main/index.js",
  "/tmp/apps/desktop/dist/preload/index.cjs",
  "/tmp/apps/desktop/dist/renderer/index.html",
  "/tmp/apps/desktop/dist/gateway/index.mjs",
] as const;

function createMtimeAccessors(entries: ReadonlyMap<string, number>): {
  exists: (path: string) => boolean;
  statMtimeMs: (path: string) => number;
} {
  return {
    exists: (path) => entries.has(path),
    statMtimeMs: (path) => {
      const mtimeMs = entries.get(path);
      if (mtimeMs === undefined) {
        throw new Error(`Unexpected stat for path: ${path}`);
      }
      return mtimeMs;
    },
  };
}

describe("ensurePackagedSmokeArtifact", () => {
  it("reuses the restored CI artifact without rebuilding when trust mode is enabled", () => {
    const files = new Map<string, number>([
      [PACKAGED_SMOKE_STAMP_PATH, 100],
      [PACKAGED_EXECUTABLE_CANDIDATES[0], 90],
    ]);
    const fs = createMtimeAccessors(files);
    const ensureBuildArtifacts = vi.fn();
    const rebuildPackagedRelease = vi.fn();
    const log = vi.fn();

    const result = ensurePackagedSmokeArtifact({
      env: { [TRUST_PACKAGED_SMOKE_ARTIFACT_ENV]: "1" },
      packagedSmokeStampPath: PACKAGED_SMOKE_STAMP_PATH,
      packagedExecutableCandidates: PACKAGED_EXECUTABLE_CANDIDATES,
      currentBuildArtifactPaths: CURRENT_BUILD_ARTIFACT_PATHS,
      ensureBuildArtifacts,
      rebuildPackagedRelease,
      log,
      ...fs,
    });

    expect(result).toBe("restored-ci-artifact");
    expect(ensureBuildArtifacts).not.toHaveBeenCalled();
    expect(rebuildPackagedRelease).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Using restored packaged smoke artifact from CI build job.");
  });

  it("fails fast in CI trust mode when the restored artifact contract is broken", () => {
    const files = new Map<string, number>([[PACKAGED_SMOKE_STAMP_PATH, 100]]);
    const fs = createMtimeAccessors(files);
    const ensureBuildArtifacts = vi.fn();
    const rebuildPackagedRelease = vi.fn();
    const log = vi.fn();

    expect(() =>
      ensurePackagedSmokeArtifact({
        env: { [TRUST_PACKAGED_SMOKE_ARTIFACT_ENV]: "1" },
        packagedSmokeStampPath: PACKAGED_SMOKE_STAMP_PATH,
        packagedExecutableCandidates: PACKAGED_EXECUTABLE_CANDIDATES,
        currentBuildArtifactPaths: CURRENT_BUILD_ARTIFACT_PATHS,
        ensureBuildArtifacts,
        rebuildPackagedRelease,
        log,
        ...fs,
      }),
    ).toThrow("CI packaged smoke artifact contract broken");

    expect(ensureBuildArtifacts).not.toHaveBeenCalled();
    expect(rebuildPackagedRelease).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("preserves local reuse behavior when the packaged release is still current", () => {
    const files = new Map<string, number>([
      [PACKAGED_SMOKE_STAMP_PATH, 100],
      [PACKAGED_EXECUTABLE_CANDIDATES[0], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[0], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[1], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[2], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[3], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[4], 90],
    ]);
    const fs = createMtimeAccessors(files);
    const ensureBuildArtifacts = vi.fn();
    const rebuildPackagedRelease = vi.fn();
    const log = vi.fn();

    const result = ensurePackagedSmokeArtifact({
      env: {},
      packagedSmokeStampPath: PACKAGED_SMOKE_STAMP_PATH,
      packagedExecutableCandidates: PACKAGED_EXECUTABLE_CANDIDATES,
      currentBuildArtifactPaths: CURRENT_BUILD_ARTIFACT_PATHS,
      ensureBuildArtifacts,
      rebuildPackagedRelease,
      log,
      ...fs,
    });

    expect(result).toBe("reused-local-release");
    expect(ensureBuildArtifacts).toHaveBeenCalledTimes(1);
    expect(rebuildPackagedRelease).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("rebuilds locally when the packaged release is stale outside CI trust mode", () => {
    const files = new Map<string, number>([
      [PACKAGED_SMOKE_STAMP_PATH, 100],
      [PACKAGED_EXECUTABLE_CANDIDATES[0], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[0], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[1], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[2], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[3], 90],
      [CURRENT_BUILD_ARTIFACT_PATHS[4], 120],
    ]);
    const fs = createMtimeAccessors(files);
    const ensureBuildArtifacts = vi.fn();
    const rebuildPackagedRelease = vi.fn();
    const log = vi.fn();

    const result = ensurePackagedSmokeArtifact({
      env: {},
      packagedSmokeStampPath: PACKAGED_SMOKE_STAMP_PATH,
      packagedExecutableCandidates: PACKAGED_EXECUTABLE_CANDIDATES,
      currentBuildArtifactPaths: CURRENT_BUILD_ARTIFACT_PATHS,
      ensureBuildArtifacts,
      rebuildPackagedRelease,
      log,
      ...fs,
    });

    expect(result).toBe("rebuilt-local-release");
    expect(ensureBuildArtifacts).toHaveBeenCalledTimes(1);
    expect(rebuildPackagedRelease).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Rebuilding packaged smoke artifact locally.");
  });
});
