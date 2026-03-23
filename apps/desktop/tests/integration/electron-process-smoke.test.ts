import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acquireGatewayBuildLock,
  DESKTOP_MAIN_ENTRYPOINT,
  electronCommand,
  ensureDesktopMainBuild,
  ensureDesktopNodeBuild,
  ensureDesktopPreloadBuild,
  ensureDesktopRendererBuild,
  ensureGatewayBuild,
  ensureStagedGatewayBuild,
} from "./embedded-gateway-test-utils.js";
import {
  packagedExecutableCandidates,
  resolvePackagedExecutablePath,
} from "./packaged-executable-path.js";
import { runWithLock } from "./run-with-lock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const DESKTOP_RENDERER_ENTRY = resolve(REPO_ROOT, "apps/desktop/dist/renderer/index.html");
const DESKTOP_RELEASE_DIR = resolve(REPO_ROOT, "apps/desktop/release");
const STAGED_GATEWAY_ENTRY = resolve(REPO_ROOT, "apps/desktop/dist/gateway/index.mjs");
const PACKAGED_SMOKE_ENABLED = process.env["TYRUM_RUN_PACKAGED_SMOKE"] === "1";
const DESKTOP_NODE_DIST_ENTRY = resolve(REPO_ROOT, "packages/desktop-node/dist/index.mjs");

interface ElectronProbeResult {
  available: boolean;
  reason?: string;
}

interface LaunchCommand {
  command: string;
  args: string[];
}

interface DesktopConfigShape {
  version: number;
  mode: "embedded" | "remote";
  remote: {
    wsUrl: string;
    tokenRef: string;
  };
  embedded: {
    port: number;
    tokenRef: string;
    dbPath: string;
  };
  permissions: {
    profile: "safe" | "balanced" | "poweruser";
    overrides: Record<string, boolean>;
  };
  capabilities: {
    desktop: boolean;
    playwright: boolean;
    cli: boolean;
    http: boolean;
  };
  cli: {
    allowedCommands: string[];
    allowedWorkingDirs: string[];
  };
  web: {
    allowedDomains: string[];
    headless: boolean;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code !== "ESRCH") throw error;
  }
}

const isWindows = process.platform === "win32";

function runBuildStep(args: string[], failurePrefix: string): void {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: isWindows,
  });

  if (result.status === 0) return;

  throw new Error([failurePrefix, result.stdout, result.stderr].filter(Boolean).join("\n"));
}

function findCommandPath(command: string): string | undefined {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function ensureBuildArtifacts(): void {
  ensureDesktopNodeBuild();
  ensureGatewayBuild();
  ensureStagedGatewayBuild();
  ensureDesktopMainBuild();
  ensureDesktopPreloadBuild();
  ensureDesktopRendererBuild();
}

function hasPackagedExecutable(): boolean {
  return packagedExecutableCandidates(DESKTOP_RELEASE_DIR, process.platform, process.arch).some(
    (candidate) => existsSync(candidate),
  );
}

function hasCurrentDesktopBuildArtifacts(): boolean {
  return (
    existsSync(DESKTOP_NODE_DIST_ENTRY) &&
    existsSync(DESKTOP_MAIN_ENTRYPOINT) &&
    existsSync(DESKTOP_RENDERER_ENTRY) &&
    existsSync(STAGED_GATEWAY_ENTRY)
  );
}

function isPackagedReleaseCurrent(): boolean {
  if (!hasPackagedExecutable() || !hasCurrentDesktopBuildArtifacts()) {
    return false;
  }

  const releaseMtimeMs = statSync(packagedExecutablePath()).mtimeMs;
  return [
    DESKTOP_NODE_DIST_ENTRY,
    DESKTOP_MAIN_ENTRYPOINT,
    DESKTOP_RENDERER_ENTRY,
    STAGED_GATEWAY_ENTRY,
  ].every((path) => statSync(path).mtimeMs <= releaseMtimeMs);
}

function packagedExecutablePath(): string {
  return resolvePackagedExecutablePath(
    DESKTOP_RELEASE_DIR,
    process.platform,
    process.arch,
    existsSync,
  );
}

function ensureReleaseArtifacts(): void {
  ensureBuildArtifacts();
  if (isPackagedReleaseCurrent()) return;

  rmSync(DESKTOP_RELEASE_DIR, { recursive: true, force: true });
  runBuildStep(
    ["--filter", "tyrum-desktop", "exec", "electron-builder", "--publish", "never", "--dir"],
    "Failed to build packaged tyrum-desktop directory artifacts for Electron smoke test.",
  );
}

function probeElectronRuntime(): ElectronProbeResult {
  const result = spawnSync(electronCommand(), ["--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (result.error) {
    const reason = result.error.message || String(result.error);
    return { available: false, reason };
  }

  if (result.status !== 0) {
    const reason = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return {
      available: false,
      reason: reason || `electron exited with code ${String(result.status)}`,
    };
  }

  return { available: true };
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => rejectPort(new Error("Unable to allocate free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function writeDesktopConfig(tyrumHome: string, port: number, dbPath: string): void {
  mkdirSync(tyrumHome, { recursive: true });
  const configPath = join(tyrumHome, "desktop-node.json");
  const config: DesktopConfigShape = {
    version: 1,
    mode: "embedded",
    remote: {
      wsUrl: "ws://127.0.0.1:8788/ws",
      tokenRef: "",
    },
    embedded: {
      port,
      tokenRef: "",
      dbPath,
    },
    permissions: {
      profile: "balanced",
      overrides: {},
    },
    capabilities: {
      desktop: true,
      playwright: false,
      cli: false,
      http: false,
    },
    cli: {
      allowedCommands: [],
      allowedWorkingDirs: [],
    },
    web: {
      allowedDomains: [],
      headless: true,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function buildLaunchCommand(
  command: string,
  args: string[],
  useVirtualDisplay: boolean,
): LaunchCommand {
  if (useVirtualDisplay) {
    return {
      command: XVFB_RUN_PATH!,
      args: ["-a", command, ...args],
    };
  }
  return { command, args };
}

function buildElectronLaunch(entrypoint: string, useVirtualDisplay: boolean): LaunchCommand {
  return buildLaunchCommand(
    electronCommand(),
    ["--disable-gpu", "--no-sandbox", entrypoint],
    useVirtualDisplay,
  );
}

function buildPackagedAppLaunch(useVirtualDisplay: boolean): LaunchCommand {
  return buildLaunchCommand(
    packagedExecutablePath(),
    ["--disable-gpu", "--no-sandbox"],
    useVirtualDisplay,
  );
}

async function waitForGatewayHealth(
  url: string,
  child: ChildProcessWithoutNullStreams,
  output: () => string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Electron exited before gateway became healthy (code=${child.exitCode}, signal=${child.signalCode}).\n${output()}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.status === 200) {
        const body = (await response.json()) as { status?: string };
        if (body.status === "ok") return;
      }
    } catch {
      // Gateway may still be booting.
    }

    await delay(200);
  }

  throw new Error(`Gateway did not become healthy within ${timeoutMs}ms.\n${output()}`);
}

async function waitForGatewayDown(url: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await delay(200);
  }
  throw new Error(`Gateway still reachable after ${timeoutMs}ms: ${url}`);
}

async function stopElectronProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const pid = child.pid;
  if (!pid) {
    child.kill("SIGTERM");
  } else if (process.platform === "win32") {
    // taskkill /T terminates the target process and all descendants.
    spawnSync("taskkill", ["/PID", String(pid), "/T"], { stdio: "ignore" });
  } else {
    // Use process-group signaling so xvfb-run wrapper + Electron + gateway
    // receive shutdown signals together.
    killProcessGroup(pid, "SIGTERM");
  }
  const maybeExit = await Promise.race([once(child, "exit"), delay(10_000).then(() => null)]);

  if (maybeExit !== null) return;

  if (child.exitCode === null && child.signalCode === null) {
    if (!pid) {
      child.kill("SIGKILL");
    } else if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      killProcessGroup(pid, "SIGKILL");
    }

    await Promise.race([once(child, "exit"), delay(5_000)]);
  }
}

async function runDesktopGatewaySmoke(
  launch: LaunchCommand,
  envOverrides: NodeJS.ProcessEnv,
): Promise<void> {
  const port = await findAvailablePort();
  const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-electron-smoke-"));
  const tyrumHome = join(tempRoot, ".tyrum");
  const dbPath = join(tempRoot, "gateway", "gateway.db");
  const healthUrl = `http://127.0.0.1:${port}/healthz`;
  writeDesktopConfig(tyrumHome, port, dbPath);

  let stdout = "";
  let stderr = "";
  let gatewayWasHealthy = false;

  const child = spawn(launch.command, launch.args, {
    cwd: REPO_ROOT,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      TYRUM_HOME: tyrumHome,
      TYRUM_DISABLE_STARTUP_UPDATE_CHECK: "1",
      NODE_ENV: "test",
      ELECTRON_DISABLE_SANDBOX: "1",
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const output = () => {
    const probeReason = electronProbe.reason ? `\nProbe reason: ${electronProbe.reason}` : "";
    const displayInfo = `\nLaunch: ${launch.command} ${launch.args.join(" ")}`;
    return `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}${probeReason}${displayInfo}`;
  };

  try {
    await waitForGatewayHealth(healthUrl, child, output);
    gatewayWasHealthy = true;

    const healthRes = await fetch(healthUrl);
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as { status: string };
    expect(healthBody.status).toBe("ok");
  } finally {
    await stopElectronProcess(child);
    if (gatewayWasHealthy) {
      await waitForGatewayDown(healthUrl);
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const electronProbe = probeElectronRuntime();
const XVFB_RUN_PATH = findCommandPath("xvfb-run");
const NEEDS_VIRTUAL_DISPLAY = process.platform === "linux" && !process.env["DISPLAY"];
const CAN_LAUNCH_ELECTRON =
  electronProbe.available && (!NEEDS_VIRTUAL_DISPLAY || XVFB_RUN_PATH !== undefined);

describe("desktop full Electron process smoke", () => {
  it.skipIf(!CAN_LAUNCH_ELECTRON)(
    "launches desktop main process and starts embedded gateway",
    { timeout: 300_000 },
    async () => {
      await runWithLock(acquireGatewayBuildLock, async () => {
        ensureBuildArtifacts();
      });

      const launch = buildElectronLaunch(DESKTOP_MAIN_ENTRYPOINT, NEEDS_VIRTUAL_DISPLAY);
      await runDesktopGatewaySmoke(launch, { VITE_DEV_SERVER_URL: "about:blank" });
    },
  );

  it.skipIf(!CAN_LAUNCH_ELECTRON || !PACKAGED_SMOKE_ENABLED)(
    "launches the packaged desktop app and starts the embedded gateway",
    { timeout: 600_000 },
    async () => {
      await runWithLock(acquireGatewayBuildLock, async () => {
        ensureReleaseArtifacts();
      });

      const launch = buildPackagedAppLaunch(NEEDS_VIRTUAL_DISPLAY);
      await runDesktopGatewaySmoke(launch, {});
    },
  );
});
