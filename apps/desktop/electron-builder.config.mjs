import { createHash } from "node:crypto";
import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const electronPackagePath = require.resolve("electron/package.json");
const electronPackage = require(electronPackagePath);
const installedElectronDist = join(dirname(electronPackagePath), "dist");
const stagedGatewayDir = join(import.meta.dirname, "dist", "gateway");

export function getMacElectronCacheZipPath(homeDirectory, arch, version) {
  const fileName = `electron-v${version}-darwin-${arch}.zip`;
  const strippedUrl = `https://github.com/electron/electron/releases/download/v${version}`;
  const cacheKey = createHash("sha256").update(strippedUrl).digest("hex");
  return join(homeDirectory, "Library", "Caches", "electron", cacheKey, fileName);
}

export function resolveElectronDist({
  platform = process.platform,
  arch = process.arch,
  homeDirectory = homedir(),
} = {}) {
  if (platform === "darwin") {
    const cachedZipPath = getMacElectronCacheZipPath(homeDirectory, arch, electronPackage.version);
    return existsSync(cachedZipPath) ? cachedZipPath : undefined;
  }

  return installedElectronDist;
}

export function resolvePackagedResourcesDir({ appOutDir, electronPlatformName, productFilename }) {
  if (electronPlatformName === "darwin") {
    return join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }

  return join(appOutDir, "resources");
}

export function copyStagedGatewayIntoPackagedResources({
  appOutDir,
  electronPlatformName,
  productFilename,
  sourceGatewayDir = stagedGatewayDir,
}) {
  const resourcesDir = resolvePackagedResourcesDir({
    appOutDir,
    electronPlatformName,
    productFilename,
  });
  const targetGatewayDir = join(resourcesDir, "gateway");

  rmSync(targetGatewayDir, { recursive: true, force: true });
  cpSync(sourceGatewayDir, targetGatewayDir, { recursive: true });
}

export default {
  appId: "net.tyrum.desktop",
  productName: "Tyrum",
  protocols: {
    name: "Tyrum",
    schemes: ["tyrum"],
  },
  directories: {
    output: "release",
  },
  npmRebuild: false,
  electronDist: resolveElectronDist(),
  publish: [
    {
      provider: "github",
      owner: "tyrumai",
      repo: "tyrum",
    },
  ],
  files: ["dist/**/*"],
  asarUnpack: [
    "node_modules/@nut-tree-fork/**",
    "node_modules/tesseract.js/**",
    "node_modules/tesseract.js-core/**",
    "dist/gateway/node_modules/**/better-sqlite3/build/**",
  ],
  afterPack: async (context) => {
    copyStagedGatewayIntoPackagedResources({
      appOutDir: context.appOutDir,
      electronPlatformName: context.electronPlatformName,
      productFilename: context.packager.appInfo.productFilename,
    });
  },
  extraResources: [
    {
      from: "build/icons/32x32.png",
      to: "tray/32x32.png",
    },
    {
      from: "build/tray-macos-template.svg",
      to: "tray/macos-template.svg",
    },
  ],
  mac: {
    icon: "build/icon.icns",
    target: ["dmg", "zip"],
    category: "public.app-category.productivity",
    hardenedRuntime: true,
  },
  win: {
    icon: "build/icon.ico",
    target: ["nsis", "portable"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Tyrum",
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
  },
  linux: {
    icon: "build/icons",
    target: ["AppImage", "tar.gz"],
    category: "Utility",
    desktop: {
      entry: {
        Name: "Tyrum",
        Comment: "Tyrum desktop app",
        StartupWMClass: "Tyrum",
      },
    },
  },
};
