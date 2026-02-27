import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("desktop packaging configuration", () => {
  it("includes per-OS icon + installer metadata in electron-builder config", () => {
    const configPath = join(__dirname, "..", "electron-builder.yml");
    const config = readFileSync(configPath, "utf8");

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

    expect(config).toMatch(/^\s*linux:\s*$/m);
    expect(config).toMatch(/^\s*icon:\s*build\/icons\s*$/m);
    expect(config).toMatch(/^\s*desktop:\s*$/m);
    expect(config).toMatch(/^\s*StartupWMClass:\s*Tyrum\s*$/m);
  });

  it("ships the icon assets used by the release builds", () => {
    const icnsPath = join(__dirname, "..", "build", "icon.icns");
    const icoPath = join(__dirname, "..", "build", "icon.ico");
    const pngPath = join(__dirname, "..", "build", "icons", "512x512.png");
    const requiredPaths = [icnsPath, icoPath, pngPath];

    for (const path of requiredPaths) {
      expect(existsSync(path)).toBe(true);
    }

    const icnsHeader = readFileSync(icnsPath).subarray(0, 4).toString("ascii");
    expect(icnsHeader).toBe("icns");

    const icoHeader = readFileSync(icoPath).subarray(0, 4);
    expect(Array.from(icoHeader)).toEqual([0x00, 0x00, 0x01, 0x00]);

    const pngHeader = readFileSync(pngPath).subarray(0, 8);
    expect(Array.from(pngHeader)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
