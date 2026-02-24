import { spawn, spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const GATEWAY_ENTRYPOINT = resolve(PACKAGE_ROOT, "dist/index.mjs");
const GATEWAY_MIGRATIONS_DIR = resolve(PACKAGE_ROOT, "migrations/sqlite");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const GATEWAY_SRC_ENTRYPOINT = resolve(PACKAGE_ROOT, "src/index.ts");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

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
  timeoutMs = 5_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  const maybeExit = await Promise.race([
    once(child, "exit"),
    delay(timeoutMs).then(() => null),
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
    "starts the real gateway and serves /healthz and /agent/status",
    { timeout: 60_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();

        const port = await findAvailablePort();
        const gatewayToken = "tyrum-test-token";
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
            GATEWAY_TOKEN: gatewayToken,
            TYRUM_HOME: tyrumHome,
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

          const agentStatusUrl = `http://127.0.0.1:${port}/agent/status`;
          const agentStatusResponse = await fetch(agentStatusUrl, {
            headers: {
              Authorization: `Bearer ${gatewayToken}`,
            },
          });
          expect(agentStatusResponse.status).toBe(200);
          const agentStatusBody = (await agentStatusResponse.json()) as {
            enabled: boolean;
          };
          expect(agentStatusBody.enabled).toBe(true);
        } finally {
          await stopChildProcess(child);
          rmSync(tempRoot, { recursive: true, force: true });
        }
      } finally {
        releaseBuildLock();
      }
    },
  );

  // Windows runners do not reliably deliver a catchable SIGTERM/SIGINT to a Node child
  // process when its stdio is piped, so we can't assert graceful shutdown behavior there.
  const itShutdown = process.platform === "win32" ? it.skip : it;

  itShutdown(
    "processes gateway.shutdown hooks before stopping the worker loop",
    { timeout: 60_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();

        const port = await findAvailablePort();
        const gatewayToken = "tyrum-test-token";
        const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-shutdown-hooks-"));
        const tyrumHome = join(tempRoot, ".tyrum");
        mkdirSync(tyrumHome, { recursive: true });
        const dbPath = join(tempRoot, "gateway.db");
        const hookKey = "hook:550e8400-e29b-41d4-a716-446655440000";

        writeFileSync(
          join(tyrumHome, "hooks.yml"),
          `v: 1\nhooks:\n  - hook_key: ${hookKey}\n    event: gateway.shutdown\n    lane: cron\n    steps:\n      - type: CLI\n        args:\n          cmd: echo\n          args: ["shutdown hook"]\n`,
          "utf8",
        );

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
            GATEWAY_TOKEN: gatewayToken,
            TYRUM_HOME: tyrumHome,
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
        } finally {
          await stopChildProcess(child, 20_000);
        }

        const db = new Database(dbPath);
        try {
          const row = db
            .prepare(
              `SELECT r.status AS status, r.paused_reason AS paused_reason, j.trigger_json AS trigger_json
               FROM execution_runs r
               JOIN execution_jobs j ON j.job_id = r.job_id
               WHERE r.key = ?
               ORDER BY r.created_at DESC
               LIMIT 1`,
            )
            .get(hookKey) as
            | { status: string; paused_reason: string | null; trigger_json: string }
            | undefined;

          expect(row, `gateway.shutdown hook run missing.\n${output()}`).toBeTruthy();
          if (!row) return;

          expect(row.status, output()).toBe("paused");
          expect(row.paused_reason, output()).toBe("policy");

          const trigger = JSON.parse(row.trigger_json) as { kind?: string; metadata?: Record<string, unknown> };
          expect(trigger.kind, output()).toBe("hook");
          expect(trigger.metadata?.["hook_event"], output()).toBe("gateway.shutdown");
          expect(trigger.metadata?.["hook_key"], output()).toBe(hookKey);
        } finally {
          db.close();
          rmSync(tempRoot, { recursive: true, force: true });
        }
      } finally {
        releaseBuildLock();
      }
    },
  );

  itShutdown(
    "does not miss gateway.shutdown hooks when the worker is busy",
    { timeout: 60_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();

        const port = await findAvailablePort();
        const gatewayToken = "tyrum-test-token";
        const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-shutdown-hooks-busy-"));
        const tyrumHome = join(tempRoot, ".tyrum");
        mkdirSync(tyrumHome, { recursive: true });
        const dbPath = join(tempRoot, "gateway.db");
        const startHookKey = "hook:550e8400-e29b-41d4-a716-446655440001";
        const shutdownHookKey = "hook:550e8400-e29b-41d4-a716-446655440002";

        // Allow CLI hooks to run so the gateway.start hook can keep the worker busy for >2s.
        writeFileSync(
          join(tyrumHome, "policy.yml"),
          `v: 1\ntools:\n  default: require_approval\n  allow: ["tool.exec"]\n  require_approval: []\n  deny: []\n`,
          "utf8",
        );

        writeFileSync(
          join(tyrumHome, "hooks.yml"),
          `v: 1\nhooks:\n  - hook_key: ${startHookKey}\n    event: gateway.start\n    lane: cron\n    steps:\n      - type: CLI\n        args:\n          cmd: ${process.execPath}\n          args: ["-e", "setTimeout(() => {}, 3000)"]\n  - hook_key: ${shutdownHookKey}\n    event: gateway.shutdown\n    lane: cron\n    steps:\n      - type: CLI\n        args:\n          cmd: ${process.execPath}\n          args: ["-e", "process.exit(0)"]\n`,
          "utf8",
        );

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
            GATEWAY_TOKEN: gatewayToken,
            TYRUM_HOME: tyrumHome,
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

          // Ensure the start hook is running (worker is busy) before triggering shutdown.
          const db = new Database(dbPath);
          try {
            const startedAt = Date.now();
            for (;;) {
              if (Date.now() - startedAt > 10_000) {
                throw new Error(`gateway.start hook did not begin running.\n${output()}`);
              }
              try {
                const row = db
                  .prepare(
                    `SELECT status
                     FROM execution_runs
                     WHERE key = ?
                     ORDER BY created_at DESC
                     LIMIT 1`,
                  )
                  .get(startHookKey) as { status: string } | undefined;
                if (row?.status === "running") break;
              } catch {
                // DB may be briefly busy while the gateway is migrating / writing.
              }
              await delay(50);
            }
          } finally {
            db.close();
          }
        } finally {
          await stopChildProcess(child, 20_000);
        }

        const db = new Database(dbPath);
        try {
          const row = db
            .prepare(
              `SELECT r.status AS status, j.trigger_json AS trigger_json
               FROM execution_runs r
               JOIN execution_jobs j ON j.job_id = r.job_id
               WHERE r.key = ?
               ORDER BY r.created_at DESC
               LIMIT 1`,
            )
            .get(shutdownHookKey) as { status: string; trigger_json: string } | undefined;

          expect(row, `gateway.shutdown hook run missing.\n${output()}`).toBeTruthy();
          if (!row) return;

          expect(row.status, output()).not.toBe("queued");

          const trigger = JSON.parse(row.trigger_json) as { kind?: string; metadata?: Record<string, unknown> };
          expect(trigger.kind, output()).toBe("hook");
          expect(trigger.metadata?.["hook_event"], output()).toBe("gateway.shutdown");
          expect(trigger.metadata?.["hook_key"], output()).toBe(shutdownHookKey);
        } finally {
          db.close();
          rmSync(tempRoot, { recursive: true, force: true });
        }
      } finally {
        releaseBuildLock();
      }
    },
  );
});
