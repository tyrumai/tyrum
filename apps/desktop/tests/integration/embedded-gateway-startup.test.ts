import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, statSync, unlinkSync } from "node:fs";
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
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const GATEWAY_SRC_ENTRYPOINT = resolve(REPO_ROOT, "packages/gateway/src/index.ts");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireGatewayBuildLock(timeoutMs = 60_000): () => void {
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

function formatBuildFailure(
  prefix: string,
  result: ReturnType<typeof spawnSync>,
): string {
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
  });
}

function waitForGatewayBuildByAnotherWorker(timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(GATEWAY_BIN)) return true;
    sleepSync(200);
  }
  return existsSync(GATEWAY_BIN);
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(GATEWAY_BIN)) return true;

  const gatewayMtime = statSync(GATEWAY_BIN).mtimeMs;

  if (existsSync(GATEWAY_SRC_ENTRYPOINT)) {
    const srcMtime = statSync(GATEWAY_SRC_ENTRYPOINT).mtimeMs;
    if (gatewayMtime < srcMtime) return true;
  }

  if (existsSync(SCHEMAS_DIST)) {
    const schemasMtime = statSync(SCHEMAS_DIST).mtimeMs;
    if (gatewayMtime < schemasMtime) return true;
  }

  return false;
}

function ensureGatewayBuild(): void {
  if (!gatewayBuildIsStale()) return;

  const args = ["--filter", "@tyrum/gateway", "build"];
  const result = tryGatewayBuild(pnpmCommand(), args);
  if (result.status === 0 || existsSync(GATEWAY_BIN)) return;
  if (waitForGatewayBuildByAnotherWorker(5_000)) return;

  if (result.error?.message.includes("ENOENT")) {
    const corepackResult = tryGatewayBuild("corepack", ["pnpm", ...args]);
    if (corepackResult.status === 0 || existsSync(GATEWAY_BIN)) return;
    if (waitForGatewayBuildByAnotherWorker(5_000)) return;

    throw new Error(
      formatBuildFailure(
        "Failed to build @tyrum/gateway before desktop integration test via pnpm/corepack.",
        corepackResult,
      ),
    );
  }

  throw new Error(
    formatBuildFailure(
      "Failed to build @tyrum/gateway before desktop integration test.",
      result,
    ),
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
  let releaseBuildLock: (() => void) | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    if (releaseBuildLock) {
      releaseBuildLock();
      releaseBuildLock = undefined;
    }
  });

  it(
    "starts embedded gateway via GatewayManager and passes health check",
    { timeout: 60_000 },
    async () => {
      releaseBuildLock = acquireGatewayBuildLock();
      ensureGatewayBuild();

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
