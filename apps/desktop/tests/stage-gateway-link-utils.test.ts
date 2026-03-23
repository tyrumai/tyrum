import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeSymbolicLinks } from "../scripts/stage-gateway-link-utils.mjs";

describe("materializeSymbolicLinks", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (!tempRoot) return;
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("replaces staged dependency directory links with copied directories", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "tyrum-stage-links-"));

    const externalPackageDir = join(
      tempRoot,
      "external/@smithy/config-resolver/dist-types/ts3.4/endpointsConfig",
    );
    mkdirSync(externalPackageDir, { recursive: true });
    const expectedFile = join(externalPackageDir, "resolveCustomEndpointsConfig.d.ts");
    writeFileSync(expectedFile, "export {};\n");

    const bundleRoot = join(tempRoot, "bundle");
    const stagedPackageDir = join(bundleRoot, "node_modules/@smithy");
    mkdirSync(stagedPackageDir, { recursive: true });
    const stagedLinkPath = join(stagedPackageDir, "config-resolver");
    symlinkSync(
      join(tempRoot, "external/@smithy/config-resolver"),
      stagedLinkPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    materializeSymbolicLinks(bundleRoot);

    expect(lstatSync(stagedLinkPath).isSymbolicLink()).toBe(false);
    expect(
      readFileSync(
        join(stagedLinkPath, "dist-types/ts3.4/endpointsConfig/resolveCustomEndpointsConfig.d.ts"),
        "utf8",
      ),
    ).toContain("export {}");
  });
});
