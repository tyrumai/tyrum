import { resolve } from "node:path";

export function packagedExecutableCandidates(
  releaseDir: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): readonly string[] {
  switch (platform) {
    case "darwin": {
      const macExecutable = "Tyrum.app/Contents/MacOS/Tyrum";
      const directories =
        arch === "arm64"
          ? ["mac-arm64", "mac-universal", "mac"]
          : ["mac", "mac-universal", "mac-arm64"];
      return directories.map((directory) => resolve(releaseDir, directory, macExecutable));
    }
    case "linux":
      return [resolve(releaseDir, "linux-unpacked/tyrum-desktop")];
    case "win32":
      return [resolve(releaseDir, "win-unpacked/Tyrum.exe")];
    default:
      throw new Error(`Unsupported platform for packaged desktop smoke: ${platform}`);
  }
}

export function resolvePackagedExecutablePath(
  releaseDir: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  exists: (path: string) => boolean,
): string {
  const candidates = packagedExecutableCandidates(releaseDir, platform, arch);
  const match = candidates.find((candidate) => exists(candidate));

  if (match) return match;

  throw new Error(`Packaged desktop executable not found. Checked: ${candidates.join(", ")}`);
}
