import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PACKAGED_SMOKE_STAMP_FILENAME,
  resolvePackagedSmokeStampPath,
  writePackagedSmokeStamp,
} from "../scripts/write-packaged-smoke-stamp.mjs";

describe("writePackagedSmokeStamp", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (!tempRoot) return;
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("writes the packaged smoke reuse marker into the desktop release directory", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "tyrum-packaged-smoke-stamp-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir, { recursive: true });

    const stampPath = writePackagedSmokeStamp(releaseDir);

    expect(stampPath).toBe(resolvePackagedSmokeStampPath(releaseDir));
    expect(stampPath).toBe(join(releaseDir, PACKAGED_SMOKE_STAMP_FILENAME));

    const stampContents = readFileSync(stampPath, "utf8").trim();
    expect(Number.isNaN(Date.parse(stampContents))).toBe(false);
    expect(statSync(stampPath).isFile()).toBe(true);
  });

  it("fails when the desktop release directory does not exist", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "tyrum-packaged-smoke-stamp-"));
    const missingReleaseDir = join(tempRoot, "missing-release");

    expect(() => writePackagedSmokeStamp(missingReleaseDir)).toThrow(
      `Desktop release directory not found: ${missingReleaseDir}`,
    );
  });
});
