import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { Icns } from "@fiahfy/icns";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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
  it("includes per-OS icon + installer metadata in electron-builder config", async () => {
    const configPath = join(__dirname, "..", "electron-builder.config.mjs");
    const configModule = (await import(pathToFileURL(configPath).href)) as {
      default: Record<string, unknown>;
      getMacElectronCacheZipPath: (homeDirectory: string, arch: string, version: string) => string;
      resolveElectronDist: (options?: {
        platform?: string;
        arch?: string;
        homeDirectory?: string;
      }) => string | undefined;
    };
    const config = configModule.default as {
      protocols: { schemes: string[] };
      npmRebuild: boolean;
      electronDist?: string;
      files: string[];
      asarUnpack: string[];
      extraResources: Array<{ from: string; to: string }>;
      mac: { icon: string; hardenedRuntime: boolean; target: string[] };
      win: { icon: string; target: string[] };
      nsis: {
        oneClick: boolean;
        allowToChangeInstallationDirectory: boolean;
        createDesktopShortcut: boolean;
        createStartMenuShortcut: boolean;
        installerIcon: string;
      };
      linux: {
        icon: string;
        target: string[];
        desktop: { entry: { StartupWMClass: string } };
      };
    };
    const configSource = readFileSync(configPath, "utf8");
    const expectedElectronDist = join(dirname(require.resolve("electron/package.json")), "dist");
    const expectedResolvedElectronDist = configModule.resolveElectronDist();

    expect(config.protocols.schemes).toEqual(["tyrum"]);
    expect(config.npmRebuild).toBe(false);
    expect(config.electronDist).toBe(expectedResolvedElectronDist);
    if (expectedResolvedElectronDist !== undefined) {
      expect(existsSync(expectedResolvedElectronDist)).toBe(true);
    }
    if (process.platform !== "darwin") {
      expect(config.electronDist).toBe(expectedElectronDist);
    }
    expect(configSource).toContain('require.resolve("electron/package.json")');
    expect(configSource).toContain('platform === "darwin"');
    expect(config.files).toEqual(["dist/**/*"]);
    expect(config.asarUnpack).toContain("node_modules/@nut-tree-fork/**");
    expect(config.asarUnpack).toContain("dist/gateway/node_modules/**/better-sqlite3/build/**");
    expect(config.asarUnpack).not.toContain("dist/gateway/node_modules/**/better-sqlite3/**");
    expect(config.extraResources).toContainEqual({
      from: "dist/gateway",
      to: "gateway",
    });
    expect(config.extraResources).toContainEqual({
      from: "build/tray-macos-template.svg",
      to: "tray/macos-template.svg",
    });

    expect(config.mac.icon).toBe("build/icon.icns");
    expect(config.mac.target).toEqual(["dmg", "zip"]);
    expect(config.mac.hardenedRuntime).toBe(true);

    expect(config.win.icon).toBe("build/icon.ico");
    expect(config.win.target).toEqual(["nsis", "portable"]);

    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true);
    expect(config.nsis.createDesktopShortcut).toBe(true);
    expect(config.nsis.createStartMenuShortcut).toBe(true);
    expect(config.nsis.installerIcon).toBe("build/icon.ico");

    expect(config.linux.icon).toBe("build/icons");
    expect(config.linux.target).toEqual(["AppImage", "tar.gz"]);
    expect(config.linux.desktop.entry.StartupWMClass).toBe("Tyrum");

    const homeDirectory = mkdtempSync(join(tmpdir(), "packaging-config-"));
    const expectedMacZipPath = configModule.getMacElectronCacheZipPath(
      homeDirectory,
      "arm64",
      "41.0.3",
    );
    const expectedCacheKey = createHash("sha256")
      .update("https://github.com/electron/electron/releases/download/v41.0.3")
      .digest("hex");
    expect(expectedMacZipPath).toBe(
      join(
        homeDirectory,
        "Library",
        "Caches",
        "electron",
        expectedCacheKey,
        "electron-v41.0.3-darwin-arm64.zip",
      ),
    );
    expect(
      configModule.resolveElectronDist({
        platform: "darwin",
        arch: "arm64",
        homeDirectory,
      }),
    ).toBeUndefined();

    mkdirSync(dirname(expectedMacZipPath), { recursive: true });
    writeFileSync(expectedMacZipPath, "");
    expect(
      configModule.resolveElectronDist({
        platform: "darwin",
        arch: "arm64",
        homeDirectory,
      }),
    ).toBe(expectedMacZipPath);
  });

  it("ships the icon assets used by the release builds", () => {
    const icnsPath = join(__dirname, "..", "build", "icon.icns");
    const icoPath = join(__dirname, "..", "build", "icon.ico");
    const pngPath = join(__dirname, "..", "build", "icons", "512x512.png");
    const sourceSvgPath = join(__dirname, "..", "build", "icon.svg");
    const trayTemplatePath = join(__dirname, "..", "build", "tray-macos-template.svg");
    const requiredPaths = [icnsPath, icoPath, pngPath, sourceSvgPath, trayTemplatePath];

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

    const sourceSvg = readFileSync(sourceSvgPath, "utf8");
    expect(sourceSvg).not.toContain('<path d=""');

    const trayTemplate = readFileSync(trayTemplatePath, "utf8");
    expect(trayTemplate).toContain("<svg");
    expect(trayTemplate).toContain('fill="black"');
    expect(trayTemplate).not.toContain('<path d=""');
  });
});
