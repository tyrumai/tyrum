import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("file-type audit patch", () => {
  it("does not loop forever on malformed ASF headers pulled via jimp", async () => {
    const script = `
      import { createRequire } from "node:module";
      import { dirname } from "node:path";

      const require = createRequire(import.meta.url);
      const desktopNodePackageJson = require.resolve("./packages/desktop-node/package.json");
      const nutJsPackageJson = require.resolve("@nut-tree-fork/nut-js/package.json", {
        paths: [dirname(desktopNodePackageJson)],
      });
      const jimpPackageJson = require.resolve("jimp/package.json", { paths: [dirname(nutJsPackageJson)] });
      const jimpCorePackageJson = require.resolve("@jimp/core/package.json", { paths: [dirname(jimpPackageJson)] });
      const fileTypePath = require.resolve("file-type", { paths: [dirname(jimpCorePackageJson)] });
      const { fromBuffer } = require(fileTypePath);

      const buffer = Buffer.alloc(55);
      buffer.set(
        [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c],
        0,
      );

      const result = await fromBuffer(buffer);
      process.stdout.write(JSON.stringify(result));
    `;

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        timeout: 2_000,
        cwd: process.cwd(),
      },
    );

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ext: "asf",
      mime: "application/vnd.ms-asf",
    });
  });
});
