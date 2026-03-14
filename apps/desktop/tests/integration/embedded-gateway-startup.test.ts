import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayManager } from "../../src/main/gateway-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const GATEWAY_BIN = resolve(REPO_ROOT, "packages/gateway/dist/index.mjs");
const CLI_UTILS_DIST = resolve(REPO_ROOT, "packages/cli-utils/dist/index.mjs");
const CLI_UTILS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/cli-utils/package.json");
const CLI_UTILS_TSCONFIG = resolve(REPO_ROOT, "packages/cli-utils/tsconfig.json");
const CLI_UTILS_SRC_DIR = resolve(REPO_ROOT, "packages/cli-utils/src");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const SCHEMAS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/schemas/package.json");
const SCHEMAS_TSCONFIG = resolve(REPO_ROOT, "packages/schemas/tsconfig.json");
const SCHEMAS_SRC_DIR = resolve(REPO_ROOT, "packages/schemas/src");
const SCHEMAS_SCRIPTS_DIR = resolve(REPO_ROOT, "packages/schemas/scripts");
const GATEWAY_SRC_DIR = resolve(REPO_ROOT, "packages/gateway/src");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

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
      if (code !== "EEXIST") {
        throw err;
      }

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

function waitForBuildOutputByAnotherWorker(outputPath: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(outputPath)) return true;
    sleepSync(200);
  }
  return existsSync(outputPath);
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
  if (!existsSync(GATEWAY_BIN)) return true;
  if (!existsSync(CLI_UTILS_DIST)) return true;
  if (!existsSync(SCHEMAS_DIST)) return true;

  const gatewayMtime = statSync(GATEWAY_BIN).mtimeMs;

  if (existsSync(GATEWAY_SRC_DIR) && gatewayMtime < latestMtimeInDir(GATEWAY_SRC_DIR)) {
    return true;
  }

  if (
    existsSync(CLI_UTILS_PACKAGE_JSON) &&
    gatewayMtime < statSync(CLI_UTILS_PACKAGE_JSON).mtimeMs
  ) {
    return true;
  }

  if (existsSync(CLI_UTILS_TSCONFIG) && gatewayMtime < statSync(CLI_UTILS_TSCONFIG).mtimeMs) {
    return true;
  }

  if (existsSync(CLI_UTILS_SRC_DIR) && gatewayMtime < latestMtimeInDir(CLI_UTILS_SRC_DIR)) {
    return true;
  }

  if (existsSync(SCHEMAS_PACKAGE_JSON) && gatewayMtime < statSync(SCHEMAS_PACKAGE_JSON).mtimeMs) {
    return true;
  }

  if (existsSync(SCHEMAS_TSCONFIG) && gatewayMtime < statSync(SCHEMAS_TSCONFIG).mtimeMs) {
    return true;
  }

  if (existsSync(SCHEMAS_SRC_DIR) && gatewayMtime < latestMtimeInDir(SCHEMAS_SRC_DIR)) {
    return true;
  }

  if (existsSync(SCHEMAS_SCRIPTS_DIR) && gatewayMtime < latestMtimeInDir(SCHEMAS_SCRIPTS_DIR)) {
    return true;
  }

  if (gatewayMtime < statSync(SCHEMAS_DIST).mtimeMs) {
    return true;
  }

  if (gatewayMtime < statSync(CLI_UTILS_DIST).mtimeMs) {
    return true;
  }

  return false;
}

function ensureWorkspaceBuild(filter: string, outputPath: string, failurePrefix: string): void {
  const args = ["--filter", filter, "build"];
  const result = tryGatewayBuild("pnpm", args);
  if (result.status === 0 || existsSync(outputPath)) return;
  if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;

  if (result.error?.message.includes("ENOENT")) {
    const corepackResult = tryGatewayBuild("corepack", ["pnpm", ...args]);
    if (corepackResult.status === 0 || existsSync(outputPath)) return;
    if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;

    throw new Error(formatBuildFailure(failurePrefix, corepackResult));
  }

  throw new Error(formatBuildFailure(failurePrefix, result));
}

function ensureGatewayBuild(): void {
  if (!gatewayBuildIsStale()) return;

  ensureWorkspaceBuild(
    "@tyrum/schemas",
    SCHEMAS_DIST,
    "Failed to build @tyrum/schemas before desktop integration test.",
  );
  ensureWorkspaceBuild(
    "@tyrum/cli-utils",
    CLI_UTILS_DIST,
    "Failed to build @tyrum/cli-utils before desktop integration test.",
  );
  ensureWorkspaceBuild(
    "@tyrum/gateway",
    GATEWAY_BIN,
    "Failed to build @tyrum/gateway before desktop integration test.",
  );
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

async function waitForHealthDown(url: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Gateway still reachable after stop timeout (${timeoutMs}ms): ${url}`);
}

describe("desktop embedded gateway startup", () => {
  let manager: GatewayManager | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it(
    "starts embedded gateway via GatewayManager and passes health check",
    { timeout: 180_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
      } finally {
        releaseBuildLock();
      }

      const port = await findAvailablePort();
      tempRoot = await mkdtemp(join(tmpdir(), "tyrum-desktop-gateway-"));
      const dbPath = join(tempRoot, "gateway.db");
      const healthUrl = `http://127.0.0.1:${port}/healthz`;

      manager = new GatewayManager();
      await manager.start({
        gatewayBin: GATEWAY_BIN,
        port,
        dbPath,
        accessToken: "desktop-integration-test-token",
        host: "127.0.0.1",
      });

      expect(manager.status).toBe("running");

      const response = await fetch(healthUrl);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");

      await manager.stop();
      expect(manager.status).toBe("stopped");
      await waitForHealthDown(healthUrl);
    },
  );
});
