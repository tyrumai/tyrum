import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Icns } from "@fiahfy/icns";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parsePngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expected)) {
    throw new Error("Expected PNG signature");
  }

  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error(`Expected IHDR chunk but saw ${chunkType}`);
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe("desktop packaging configuration", () => {
  it("includes per-OS icon + installer metadata in electron-builder config", () => {
    const configPath = join(__dirname, "..", "electron-builder.yml");
    const config = readFileSync(configPath, "utf8");

    expect(config).toMatch(/^\s*protocols:\s*$/m);
    expect(config).toMatch(/^\s*schemes:\s*$/m);
    expect(config).toMatch(/^\s*-\s*tyrum\s*$/m);
    expect(config).toMatch(/^\s*npmRebuild:\s*false\s*$/m);

    expect(config).toMatch(/^\s*mac:\s*$/m);
    expect(config).toMatch(/^\s*icon:\s*build\/icon\.icns\s*$/m);

    expect(config).toMatch(/^\s*win:\s*$/m);
    expect(config).toMatch(/^\s*icon:\s*build\/icon\.ico\s*$/m);

    expect(config).toMatch(/^\s*nsis:\s*$/m);
    expect(config).toMatch(/^\s*oneClick:\s*false\s*$/m);
    expect(config).not.toMatch(/^\s*installerHeaderIcon:\s*/m);
    expect(config).toMatch(/^\s*allowToChangeInstallationDirectory:\s*true\s*$/m);
    expect(config).toMatch(/^\s*createDesktopShortcut:\s*true\s*$/m);
    expect(config).toMatch(/^\s*createStartMenuShortcut:\s*true\s*$/m);
    expect(config).toMatch(/^\s*installerIcon:\s*build\/icon\.ico\s*$/m);
    expect(config).toMatch(/^\s*-\s*from:\s*build\/tray-macos-template\.svg\s*$/m);
    expect(config).toMatch(/^\s*to:\s*tray\/macos-template\.svg\s*$/m);

    expect(config).toMatch(/^\s*linux:\s*$/m);
    expect(config).toMatch(/^\s*icon:\s*build\/icons\s*$/m);
    expect(config).toMatch(/^\s*desktop:\s*$/m);
    expect(config).toMatch(/^\s*entry:\s*$/m);
    expect(config).toMatch(/^\s*StartupWMClass:\s*Tyrum\s*$/m);
  });

  it("ships the icon assets used by the release builds", () => {
    const icnsPath = join(__dirname, "..", "build", "icon.icns");
    const icoPath = join(__dirname, "..", "build", "icon.ico");
    const pngPath = join(__dirname, "..", "build", "icons", "512x512.png");
    const trayTemplatePath = join(__dirname, "..", "build", "tray-macos-template.svg");
    const requiredPaths = [icnsPath, icoPath, pngPath, trayTemplatePath];

    for (const path of requiredPaths) {
      expect(existsSync(path)).toBe(true);
    }

    const icnsHeader = readFileSync(icnsPath).subarray(0, 4).toString("ascii");
    expect(icnsHeader).toBe("icns");

    const icns = Icns.from(readFileSync(icnsPath));
    const icnsSizesByOsType = new Map(
      icns.images.map((image) => {
        const { width, height } = parsePngDimensions(image.image);
        return [image.osType, `${width}x${height}`] as const;
      }),
    );

    expect(icnsSizesByOsType.get("icp4")).toBe("16x16");
    expect(icnsSizesByOsType.get("icp5")).toBe("32x32");
    expect(icnsSizesByOsType.get("ic11")).toBe("32x32");
    expect(icnsSizesByOsType.get("icp6")).toBe("64x64");
    expect(icnsSizesByOsType.get("ic12")).toBe("64x64");
    expect(icnsSizesByOsType.get("ic07")).toBe("128x128");
    expect(icnsSizesByOsType.get("ic08")).toBe("256x256");
    expect(icnsSizesByOsType.get("ic13")).toBe("256x256");
    expect(icnsSizesByOsType.get("ic09")).toBe("512x512");
    expect(icnsSizesByOsType.get("ic14")).toBe("512x512");
    expect(icnsSizesByOsType.get("ic10")).toBe("1024x1024");

    const icoHeader = readFileSync(icoPath).subarray(0, 4);
    expect(Array.from(icoHeader)).toEqual([0x00, 0x00, 0x01, 0x00]);

    const pngHeader = readFileSync(pngPath).subarray(0, 8);
    expect(Array.from(pngHeader)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const trayTemplate = readFileSync(trayTemplatePath, "utf8");
    expect(trayTemplate).toContain("<svg");
    expect(trayTemplate).toContain('fill="black"');
  });
});
