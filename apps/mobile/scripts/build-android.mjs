import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const ANDROID_ROOT = resolve(APP_ROOT, "android");
const isWindows = process.platform === "win32";
const wrapperPath = resolve(ANDROID_ROOT, isWindows ? "gradlew.bat" : "gradlew");

if (!existsSync(ANDROID_ROOT)) {
  throw new Error(
    `Missing Android project at ${ANDROID_ROOT}. Run "pnpm --filter @tyrum/mobile cap:add:android" first.`,
  );
}

if (!existsSync(wrapperPath)) {
  throw new Error(`Missing Gradle wrapper at ${wrapperPath}.`);
}

if (!isWindows) {
  chmodSync(wrapperPath, 0o755);
}

const javaCheck = spawnSync("java", ["-version"], { stdio: "ignore" });
if (javaCheck.status !== 0) {
  throw new Error("java is unavailable. Install a JDK before running Android builds.");
}

const result = spawnSync(wrapperPath, ["assembleDebug"], {
  cwd: ANDROID_ROOT,
  stdio: "inherit",
  shell: isWindows,
});

if (result.status === 0) {
  process.exit(0);
}

process.exit(typeof result.status === "number" ? result.status : 1);
