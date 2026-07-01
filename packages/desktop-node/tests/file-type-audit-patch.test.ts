import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

type ProbeOutput = {
  version: string;
  asfResult: {
    ext: string;
    mime: string;
  } | null;
  png: {
    width: number;
    height: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProbeOutput(value: unknown): value is ProbeOutput {
  if (!isRecord(value)) return false;

  const asfResult = value["asfResult"];
  const png = value["png"];

  return (
    typeof value["version"] === "string" &&
    (asfResult === null ||
      (isRecord(asfResult) &&
        typeof asfResult["ext"] === "string" &&
        typeof asfResult["mime"] === "string")) &&
    isRecord(png) &&
    png["width"] === 1 &&
    png["height"] === 1
  );
}

function versionParts(version: string): readonly [number, number, number] {
  const [majorText, minorText, patchText] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return [major, minor, patch];
}

function isAtLeastVersion(version: string, minimum: string): boolean {
  const actualParts = versionParts(version);
  const minimumParts = versionParts(minimum);

  for (let index = 0; index < actualParts.length; index += 1) {
    const actual = actualParts[index] ?? 0;
    const required = minimumParts[index] ?? 0;
    if (actual > required) return true;
    if (actual < required) return false;
  }

  return true;
}

describe("file-type audit remediation", () => {
  it("uses a fixed file-type release without breaking Jimp buffer detection", async () => {
    const script = `
      const { readFileSync } = require("node:fs");
      const { createRequire } = require("node:module");
      const { dirname, join } = require("node:path");

      void (async () => {
        const requireFromDesktopNode = createRequire(process.cwd() + "/packages/desktop-node/package.json");
        const nutJsPackageJson = requireFromDesktopNode.resolve("@nut-tree-fork/nut-js/package.json");
        const jimpPackageJson = require.resolve("jimp/package.json", { paths: [dirname(nutJsPackageJson)] });
        const jimpCorePackageJson = require.resolve("@jimp/core/package.json", {
          paths: [dirname(jimpPackageJson)],
        });
        const fileTypeEntry = require.resolve("file-type", { paths: [dirname(jimpCorePackageJson)] });
        const fileTypePackageJson = JSON.parse(
          readFileSync(join(dirname(fileTypeEntry), "package.json"), "utf8"),
        );
        const fileType = require(fileTypeEntry);

        if (typeof fileType.fileTypeFromBuffer !== "function") {
          throw new Error("Expected file-type to expose fileTypeFromBuffer");
        }

        const asfBuffer = Buffer.alloc(55);
        asfBuffer.set(
          [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c],
          0,
        );
        const asfResult = await fileType.fileTypeFromBuffer(asfBuffer);

        const Jimp = require(dirname(jimpPackageJson));
        const pngBuffer = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        );
        const image = await Jimp.read(pngBuffer);

        process.stdout.write(JSON.stringify({
          version: fileTypePackageJson.version,
          asfResult: asfResult ?? null,
          png: {
            width: image.bitmap.width,
            height: image.bitmap.height,
          },
        }));
      })();
    `;

    const { stdout, stderr } = await execFileAsync(process.execPath, ["-e", script], {
      timeout: 2_000,
      cwd: process.cwd(),
    });

    expect(stderr).toBe("");

    const output: unknown = JSON.parse(stdout);
    expect(isProbeOutput(output)).toBe(true);

    if (!isProbeOutput(output)) {
      throw new Error(`Unexpected probe output: ${stdout}`);
    }

    expect(isAtLeastVersion(output.version, "21.3.1")).toBe(true);
  });
});
