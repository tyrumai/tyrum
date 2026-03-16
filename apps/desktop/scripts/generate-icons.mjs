import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Icns, IcnsImage } from "@fiahfy/icns";
import { Ico, IcoImage } from "@fiahfy/ico";

const PNG_ARGS = [
  "-strip",
  "-define",
  "png:exclude-chunk=date,time",
  "-define",
  "png:compression-level=9",
];
const EMPTY_SVG_PATH_PATTERN = /^\s*<path d=""[^>]*\/>\r?\n?/gmu;

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

function requireCommand(cmd) {
  try {
    run(cmd, ["--version"]);
  } catch (err) {
    throw new Error(
      `Missing required command: ${cmd}. Install ImageMagick (magick) to regenerate icons.`,
      { cause: err },
    );
  }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function ensureCleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  ensureDir(path);
}

function renderPng(sourcePath, size, outputPath) {
  run("magick", [
    "-background",
    "none",
    sourcePath,
    "-resize",
    `${size}x${size}`,
    ...PNG_ARGS,
    outputPath,
  ]);
}

function renderPaddedPng(sourcePath, size, scale, outputPath) {
  const innerSize = Math.max(1, Math.round(size * scale));
  run("magick", [
    "-background",
    "none",
    sourcePath,
    "-resize",
    `${innerSize}x${innerSize}`,
    "-gravity",
    "center",
    "-extent",
    `${size}x${size}`,
    ...PNG_ARGS,
    outputPath,
  ]);
}

function renderSocialCard(sourcePath, outputPath) {
  run("magick", [
    "-size",
    "1200x630",
    "xc:#0a0a0a",
    "(",
    sourcePath,
    "-resize",
    "420x420",
    ")",
    "-gravity",
    "center",
    "-composite",
    ...PNG_ARGS,
    outputPath,
  ]);
}

function buildIcoBuffer(pngPaths) {
  const ico = new Ico();
  for (const path of pngPaths) {
    ico.append(IcoImage.fromPNG(readFileSync(path)));
  }
  return ico.data;
}

function stripEmptySvgPaths(svgContents) {
  return svgContents.replace(EMPTY_SVG_PATH_PATTERN, "");
}

function createMacTrayTemplateSvg(sourceSvgContents) {
  return sourceSvgContents
    .replace(/fill="[^"]*"/gu, 'fill="black"')
    .replace(/aria-label="[^"]*"/u, 'aria-label="Tyrum macOS tray icon"');
}

function generateDesktopAssets(paths, sourceSvgContents) {
  writeFileSync(paths.desktopSourceSvg, sourceSvgContents);
  const macTrayTemplateSvg = createMacTrayTemplateSvg(sourceSvgContents);
  writeFileSync(paths.sharedMacTrayTemplateSvg, macTrayTemplateSvg);
  writeFileSync(paths.desktopMacTrayTemplateSvg, macTrayTemplateSvg);

  ensureCleanDir(paths.desktopIconsDir);
  const desktopSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  for (const size of desktopSizes) {
    renderPng(paths.sourceSvg, size, join(paths.desktopIconsDir, `${size}x${size}.png`));
  }

  writeFileSync(
    paths.desktopIco,
    buildIcoBuffer(
      [16, 32, 48, 64, 128, 256].map((size) => join(paths.desktopIconsDir, `${size}x${size}.png`)),
    ),
  );

  // ICNS PNG icon types (10.7+) plus retina variants (10.8+).
  // See `@fiahfy/icns` README for the supported OSType table.
  const icnsImages = [
    [16, "icp4"],
    [32, "icp5"],
    [32, "ic11"],
    [64, "icp6"],
    [64, "ic12"],
    [128, "ic07"],
    [256, "ic08"],
    [256, "ic13"],
    [512, "ic09"],
    [512, "ic14"],
    [1024, "ic10"],
  ];

  const icns = new Icns();
  for (const [size, osType] of icnsImages) {
    icns.append(
      IcnsImage.fromPNG(readFileSync(join(paths.desktopIconsDir, `${size}x${size}.png`)), osType),
    );
  }
  writeFileSync(paths.desktopIcns, icns.data);
}

function generateWebAndDocsAssets(paths, sourceSvgContents) {
  ensureDir(paths.webPublicDir);
  ensureDir(paths.webBrandDir);
  ensureDir(paths.docsBrandDir);

  const browserFavicon = buildIcoBuffer(
    [16, 32, 48].map((size) => join(paths.desktopIconsDir, `${size}x${size}.png`)),
  );
  writeFileSync(join(paths.webPublicDir, "favicon.ico"), browserFavicon);
  writeFileSync(join(paths.docsBrandDir, "favicon.ico"), browserFavicon);

  renderPng(paths.sourceSvg, 180, join(paths.webPublicDir, "apple-touch-icon.png"));
  renderSocialCard(paths.sourceSvg, join(paths.docsBrandDir, "social-card.png"));

  writeFileSync(join(paths.webBrandDir, "app-icon.svg"), sourceSvgContents);
  writeFileSync(join(paths.docsBrandDir, "app-icon.svg"), sourceSvgContents);
  writeFileSync(
    join(paths.webBrandDir, "app-icon-512.png"),
    readFileSync(join(paths.desktopIconsDir, "512x512.png")),
  );
  writeFileSync(
    join(paths.docsBrandDir, "app-icon-512.png"),
    readFileSync(join(paths.desktopIconsDir, "512x512.png")),
  );
}

function generateMobileAssets(paths) {
  const androidLegacySizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
  };
  const androidForegroundSizes = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
  };

  for (const [directory, size] of Object.entries(androidLegacySizes)) {
    const targetDir = join(paths.androidResDir, directory);
    ensureDir(targetDir);
    renderPng(paths.sourceSvg, size, join(targetDir, "ic_launcher.png"));
    renderPng(paths.sourceSvg, size, join(targetDir, "ic_launcher_round.png"));
  }

  for (const [directory, size] of Object.entries(androidForegroundSizes)) {
    const targetDir = join(paths.androidResDir, directory);
    ensureDir(targetDir);
    renderPaddedPng(paths.sourceSvg, size, 2 / 3, join(targetDir, "ic_launcher_foreground.png"));
  }

  renderPng(paths.sourceSvg, 1024, paths.iosAppIcon);
}

const repoRoot = resolve(import.meta.dirname, "../../..");
const desktopRoot = resolve(import.meta.dirname, "..");
const buildDir = join(desktopRoot, "build");
const desktopIconsDir = join(buildDir, "icons");
const brandDir = join(repoRoot, "assets", "brand");
const sourceSvg = join(brandDir, "app-icon.svg");

if (!existsSync(sourceSvg)) {
  throw new Error(`Missing shared icon source SVG at ${sourceSvg}`);
}

requireCommand("magick");

const paths = {
  sourceSvg,
  sharedMacTrayTemplateSvg: join(brandDir, "app-icon-tray-macos-template.svg"),
  desktopSourceSvg: join(buildDir, "icon.svg"),
  desktopMacTrayTemplateSvg: join(buildDir, "tray-macos-template.svg"),
  desktopIconsDir,
  desktopIco: join(buildDir, "icon.ico"),
  desktopIcns: join(buildDir, "icon.icns"),
  webPublicDir: join(repoRoot, "apps", "web", "public"),
  webBrandDir: join(repoRoot, "apps", "web", "public", "brand"),
  docsBrandDir: join(repoRoot, "apps", "docs", "static", "img", "brand"),
  androidResDir: join(repoRoot, "apps", "mobile", "android", "app", "src", "main", "res"),
  iosAppIcon: join(
    repoRoot,
    "apps",
    "mobile",
    "ios",
    "App",
    "App",
    "Assets.xcassets",
    "AppIcon.appiconset",
    "AppIcon-512@2x.png",
  ),
};

const sourceSvgContents = stripEmptySvgPaths(readFileSync(sourceSvg, "utf8"));

generateDesktopAssets(paths, sourceSvgContents);
generateWebAndDocsAssets(paths, sourceSvgContents);
generateMobileAssets(paths);

console.log(`Generated shared brand assets from ${sourceSvg}`);
console.log(`Updated desktop icons under ${buildDir}`);
console.log(`Updated web icons under ${paths.webPublicDir}`);
console.log(`Updated docs icons under ${paths.docsBrandDir}`);
console.log(`Updated mobile launcher icons under ${paths.androidResDir} and ${paths.iosAppIcon}`);
