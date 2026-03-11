import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const IOS_ROOT = resolve(APP_ROOT, "ios", "App");
const WORKSPACE_PATH = resolve(IOS_ROOT, "App.xcworkspace");
const PROJECT_PATH = resolve(IOS_ROOT, "App.xcodeproj");

if (process.platform !== "darwin") {
  throw new Error("iOS builds require macOS with Xcode installed.");
}

if (!existsSync(IOS_ROOT)) {
  throw new Error(
    `Missing iOS project at ${IOS_ROOT}. Run "pnpm --filter @tyrum/mobile cap:add:ios" first.`,
  );
}

const xcodebuildCheck = spawnSync("xcodebuild", ["-version"], { stdio: "ignore" });
if (xcodebuildCheck.status !== 0) {
  throw new Error("xcodebuild is unavailable. Install Xcode and the iOS Simulator toolchain.");
}

const scheme = process.env.IOS_SCHEME ?? "App";
const configuration = process.env.IOS_CONFIGURATION ?? "Debug";
const destination = process.env.IOS_DESTINATION ?? "generic/platform=iOS Simulator";
const args = existsSync(WORKSPACE_PATH)
  ? [
      "-workspace",
      WORKSPACE_PATH,
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-sdk",
      "iphonesimulator",
      "-destination",
      destination,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ]
  : [
      "-project",
      PROJECT_PATH,
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-sdk",
      "iphonesimulator",
      "-destination",
      destination,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ];

const result = spawnSync("xcodebuild", args, {
  cwd: IOS_ROOT,
  stdio: "inherit",
});

if (result.status === 0) {
  process.exit(0);
}

process.exit(typeof result.status === "number" ? result.status : 1);
