import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  packagedExecutableCandidates,
  resolvePackagedExecutablePath,
} from "./integration/packaged-executable-path.js";

describe("packagedExecutableCandidates", () => {
  const releaseDir = "/tmp/tyrum-release";

  it("prefers mac-arm64 builds on darwin arm64", () => {
    expect(packagedExecutableCandidates(releaseDir, "darwin", "arm64")).toEqual([
      resolve(releaseDir, "mac-arm64/Tyrum.app/Contents/MacOS/Tyrum"),
      resolve(releaseDir, "mac-universal/Tyrum.app/Contents/MacOS/Tyrum"),
      resolve(releaseDir, "mac/Tyrum.app/Contents/MacOS/Tyrum"),
    ]);
  });

  it("prefers mac builds on darwin x64", () => {
    expect(packagedExecutableCandidates(releaseDir, "darwin", "x64")).toEqual([
      resolve(releaseDir, "mac/Tyrum.app/Contents/MacOS/Tyrum"),
      resolve(releaseDir, "mac-universal/Tyrum.app/Contents/MacOS/Tyrum"),
      resolve(releaseDir, "mac-arm64/Tyrum.app/Contents/MacOS/Tyrum"),
    ]);
  });

  it("resolves the first existing packaged executable candidate", () => {
    const match = resolve(releaseDir, "mac-universal/Tyrum.app/Contents/MacOS/Tyrum");

    expect(
      resolvePackagedExecutablePath(
        releaseDir,
        "darwin",
        "arm64",
        (candidate) => candidate === match,
      ),
    ).toBe(match);
  });
});
