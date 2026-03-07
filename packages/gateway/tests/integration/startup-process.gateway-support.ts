import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const GATEWAY_BIN = resolve(PACKAGE_ROOT, "bin/tyrum.mjs");
const GATEWAY_ENTRYPOINT = resolve(PACKAGE_ROOT, "dist/index.mjs");
const GATEWAY_MIGRATIONS_DIR = resolve(PACKAGE_ROOT, "migrations/sqlite");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const GATEWAY_SRC_DIR = resolve(PACKAGE_ROOT, "src");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

type MaybePromise<T> = T | Promise<T>;

type HomeSetupInput = {
  dbPath: string;
  tempRoot: string;
  tyrumHome: string;
};

type StartGatewayOptions = {
  tempPrefix: string;
  configureHome?: (input: HomeSetupInput) => MaybePromise<void>;
};

export type GatewayFixture = {
  child: ChildProcessWithoutNullStreams;
  cleanup: () => void;
  dbPath: string;
  healthUrl: string;
  output: () => string;
  port: number;
  stop: (timeoutMs?: number) => Promise<void>;
  stopAndCleanup: (timeoutMs?: number) => Promise<void>;
  tempRoot: string;
  tenantAdminToken: string;
  tyrumHome: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

function extractBootstrapToken(stdout: string, label: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${label}:`)) continue;
    const token = trimmed.slice(label.length + 1).trim();
    if (token.length > 0) return token;
  }
  throw new Error(`Bootstrap token '${label}' not found in gateway stdout.`);
}

export function waitForOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolvePromise();
      return;
    }

    const timer = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const isWindows = process.platform === "win32";

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireGatewayBuildLock(timeoutMs = 180_000): () => void {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(GATEWAY_BUILD_LOCK, "wx");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(GATEWAY_BUILD_LOCK);
        } catch {
          // ignore
        }
      };
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
      if (code !== "EEXIST") throw err;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for gateway build lock (${timeoutMs}ms): ${GATEWAY_BUILD_LOCK}`,
        );
      }
      sleepSync(200);
    }
  }
}

function formatBuildFailure(prefix: string, result: ReturnType<typeof spawnSync>): string {
  const details = [
    prefix,
    result.error ? `spawn error: ${result.error.message}` : undefined,
    result.status === null ? "exit status: null" : `exit status: ${String(result.status)}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean);
  return details.join("\n");
}

function tryGatewayBuild(cmd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: isWindows,
  });
}

function waitForGatewayBuildByAnotherWorker(timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(GATEWAY_ENTRYPOINT)) return true;
    sleepSync(200);
  }
  return existsSync(GATEWAY_ENTRYPOINT);
}

function latestMtimeInDir(rootDir: string): number {
  let latest = 0;
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const mtimeMs = statSync(fullPath).mtimeMs;
      if (mtimeMs > latest) latest = mtimeMs;
    }
  }

  return latest;
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(GATEWAY_ENTRYPOINT)) return true;

  const gatewayMtime = statSync(GATEWAY_ENTRYPOINT).mtimeMs;

  if (existsSync(GATEWAY_SRC_DIR) && gatewayMtime < latestMtimeInDir(GATEWAY_SRC_DIR)) {
    return true;
  }

  if (existsSync(SCHEMAS_DIST) && gatewayMtime < statSync(SCHEMAS_DIST).mtimeMs) {
    return true;
  }

  return false;
}

function ensureGatewayBuild(): void {
  if (!gatewayBuildIsStale()) return;

  const args = ["--filter", "@tyrum/gateway", "build"];
  const result = tryGatewayBuild("pnpm", args);
  if (result.status === 0 || existsSync(GATEWAY_ENTRYPOINT)) return;
  if (waitForGatewayBuildByAnotherWorker(5_000)) return;

  if (result.error?.message.includes("ENOENT")) {
    const corepackResult = tryGatewayBuild("corepack", ["pnpm", ...args]);
    if (corepackResult.status === 0 || existsSync(GATEWAY_ENTRYPOINT)) return;
    if (waitForGatewayBuildByAnotherWorker(5_000)) return;

    throw new Error(
      formatBuildFailure(
        "Failed to build @tyrum/gateway before startup test via pnpm/corepack.",
        corepackResult,
      ),
    );
  }

  throw new Error(
    formatBuildFailure("Failed to build @tyrum/gateway before startup test.", result),
  );
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();

    server.once("error", (error) => rejectPort(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => rejectPort(new Error("Unable to allocate test port.")));
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

async function stopChildProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 5_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const maybeExit = await Promise.race([once(child, "exit"), delay(timeoutMs).then(() => null)]);
  if (maybeExit !== null) return;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function waitForGatewayHealth(
  url: string,
  child: ChildProcessWithoutNullStreams,
  output: () => string,
  timeoutMs = 15_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Gateway exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode}).\n${output()}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.status === 200) {
        const body = (await response.json()) as { status?: string };
        if (body.status === "ok") return;
      }
    } catch {
      // Server may still be starting.
    }

    await delay(200);
  }

  throw new Error(`Gateway did not become healthy within ${timeoutMs}ms.\n${output()}`);
}

export async function withGatewayBuild<T>(
  action: () => MaybePromise<T>,
  options: { releaseAfterBuild?: boolean } = {},
): Promise<T> {
  let releaseBuildLock = acquireGatewayBuildLock();
  try {
    ensureGatewayBuild();
    if (options.releaseAfterBuild) {
      releaseBuildLock();
      releaseBuildLock = () => {};
    }
    return await action();
  } finally {
    releaseBuildLock();
  }
}

export async function startGatewayFixture(options: StartGatewayOptions): Promise<GatewayFixture> {
  const port = await findAvailablePort();
  const tempRoot = mkdtempSync(join(tmpdir(), options.tempPrefix));
  const tyrumHome = join(tempRoot, ".tyrum");
  const dbPath = join(tempRoot, "gateway.db");
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempRoot, { recursive: true, force: true });
  };

  try {
    mkdirSync(tyrumHome, { recursive: true });
    await options.configureHome?.({ dbPath, tempRoot, tyrumHome });

    let stdout = "";
    let stderr = "";
    const child = spawn(
      process.execPath,
      [
        GATEWAY_BIN,
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--db",
        dbPath,
        "--home",
        tyrumHome,
        "--migrations-dir",
        GATEWAY_MIGRATIONS_DIR,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const output = () => `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
    const stop = async (timeoutMs = 5_000) => {
      await stopChildProcess(child, timeoutMs);
    };
    const stopAndCleanup = async (timeoutMs = 5_000) => {
      try {
        await stop(timeoutMs);
      } finally {
        cleanup();
      }
    };

    const healthUrl = `http://127.0.0.1:${port}/healthz`;

    try {
      await waitForGatewayHealth(healthUrl, child, output);
      const tenantAdminToken = extractBootstrapToken(stdout, "default-tenant-admin");
      return {
        child,
        cleanup,
        dbPath,
        healthUrl,
        output,
        port,
        stop,
        stopAndCleanup,
        tempRoot,
        tenantAdminToken,
        tyrumHome,
      };
    } catch (error) {
      await stopAndCleanup();
      throw error;
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function writeGatewayHomeFiles(tyrumHome: string, files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(tyrumHome, name), contents, "utf8");
  }
}
