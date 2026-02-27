import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Icns, IcnsImage } from "@fiahfy/icns";
import { Ico, IcoImage } from "@fiahfy/ico";

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

const desktopRoot = resolve(import.meta.dirname, "..");
const buildDir = join(desktopRoot, "build");
const sourceSvg = join(buildDir, "icon.svg");
const iconsDir = join(buildDir, "icons");

if (!existsSync(sourceSvg)) {
  throw new Error(`Missing icon source SVG at ${sourceSvg}`);
}

requireCommand("magick");

rmSync(iconsDir, { recursive: true, force: true });
mkdirSync(iconsDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

for (const size of sizes) {
  const outputPath = join(iconsDir, `${size}x${size}.png`);
  run("magick", [
    "-background",
    "none",
    sourceSvg,
    "-resize",
    `${size}x${size}`,
    "-strip",
    "-define",
    "png:exclude-chunk=date,time",
    "-define",
    "png:compression-level=9",
    outputPath,
  ]);
}

const ico = new Ico();
for (const size of [16, 32, 48, 64, 128, 256]) {
  ico.append(IcoImage.fromPNG(readFileSync(join(iconsDir, `${size}x${size}.png`))));
}
const icoPath = join(buildDir, "icon.ico");
writeFileSync(icoPath, ico.data);

const osTypeBySize = new Map([
  [16, "icp4"],
  [32, "icp5"],
  [64, "icp6"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]);

const icns = new Icns();
for (const [size, osType] of osTypeBySize.entries()) {
  icns.append(IcnsImage.fromPNG(readFileSync(join(iconsDir, `${size}x${size}.png`)), osType));
}
const icnsPath = join(buildDir, "icon.icns");
writeFileSync(icnsPath, icns.data);

console.log(`Generated ${icoPath}`);
console.log(`Generated ${icnsPath}`);
console.log(`Generated PNG set under ${iconsDir}`);
