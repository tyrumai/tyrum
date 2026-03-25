import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const installedElectronDist = join(dirname(require.resolve("electron/package.json")), "dist");

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
  electronDist: installedElectronDist,
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
