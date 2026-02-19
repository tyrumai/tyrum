import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const GATEWAY_ENTRYPOINT = resolve(PACKAGE_ROOT, "dist/index.mjs");
const GATEWAY_MIGRATIONS_DIR = resolve(PACKAGE_ROOT, "migrations");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const GATEWAY_SRC_ENTRYPOINT = resolve(PACKAGE_ROOT, "src/index.ts");

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
    if (existsSync(GATEWAY_ENTRYPOINT)) return true;
    sleepSync(200);
  }
  return existsSync(GATEWAY_ENTRYPOINT);
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(GATEWAY_ENTRYPOINT)) return true;

  const gatewayMtime = statSync(GATEWAY_ENTRYPOINT).mtimeMs;

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
  if (result.status === 0 || existsSync(GATEWAY_ENTRYPOINT)) return;
  if (waitForGatewayBuildByAnotherWorker(5_000)) return;

  // Fallback when pnpm is not directly on PATH in worker shells.
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

  throw new Error(formatBuildFailure("Failed to build @tyrum/gateway before startup test.", result));
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
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const maybeExit = await Promise.race([
    once(child, "exit"),
    delay(5_000).then(() => null),
  ]);

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

describe("gateway startup process", () => {
  it(
    "starts the real gateway and serves /healthz",
    { timeout: 60_000 },
    async () => {
      ensureGatewayBuild();

      const port = await findAvailablePort();
      const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-startup-"));
      const tyrumHome = join(tempRoot, ".tyrum");
      const dbPath = join(tempRoot, "gateway.db");

      let stdout = "";
      let stderr = "";

      const child = spawn(process.execPath, [GATEWAY_ENTRYPOINT, "start"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          GATEWAY_HOST: "127.0.0.1",
          GATEWAY_PORT: String(port),
          GATEWAY_DB_PATH: dbPath,
          GATEWAY_MIGRATIONS_DIR,
          TYRUM_HOME: tyrumHome,
          TYRUM_AGENT_ENABLED: "0",
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

      const output = () => `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      try {
        const healthUrl = `http://127.0.0.1:${port}/healthz`;
        await waitForGatewayHealth(healthUrl, child, output);

        const healthResponse = await fetch(healthUrl);
        expect(healthResponse.status).toBe(200);
        const healthBody = (await healthResponse.json()) as { status: string };
        expect(healthBody.status).toBe("ok");
      } finally {
        await stopChildProcess(child);
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );
});
