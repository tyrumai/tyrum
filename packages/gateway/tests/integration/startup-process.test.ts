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
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { completeHandshake } from "./ws-handshake.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const GATEWAY_BIN = resolve(PACKAGE_ROOT, "bin/tyrum.mjs");
const GATEWAY_ENTRYPOINT = resolve(PACKAGE_ROOT, "dist/index.mjs");
const GATEWAY_MIGRATIONS_DIR = resolve(PACKAGE_ROOT, "migrations/sqlite");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const GATEWAY_SRC_DIR = resolve(PACKAGE_ROOT, "src");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function authProtocols(token: string): string[] {
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

function waitForOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();

    const timer = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
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

  if (existsSync(GATEWAY_SRC_DIR)) {
    const srcMtime = latestMtimeInDir(GATEWAY_SRC_DIR);
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
  const result = tryGatewayBuild("pnpm", args);
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

describe("gateway startup process", () => {
  it(
    "starts the real gateway and serves /healthz and /agent/status",
    { timeout: 180_000 },
    async () => {
      let releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
        releaseBuildLock();
        releaseBuildLock = () => {};

        const port = await findAvailablePort();
        const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-startup-"));
        const tyrumHome = join(tempRoot, ".tyrum");
        const dbPath = join(tempRoot, "gateway.db");

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

        try {
          const healthUrl = `http://127.0.0.1:${port}/healthz`;
          await waitForGatewayHealth(healthUrl, child, output);
          const tenantAdminToken = extractBootstrapToken(stdout, "default-tenant-admin");

          const healthResponse = await fetch(healthUrl);
          expect(healthResponse.status).toBe(200);
          const healthBody = (await healthResponse.json()) as { status: string };
          expect(healthBody.status).toBe("ok");

          const agentStatusUrl = `http://127.0.0.1:${port}/agent/status`;
          const agentStatusResponse = await fetch(agentStatusUrl, {
            headers: {
              Authorization: `Bearer ${tenantAdminToken}`,
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

  it(
    "resumes agent tool-execution runs on denied approvals over WebSocket",
    { timeout: 180_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();

        const port = await findAvailablePort();
        const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-ws-approval-"));
        const tyrumHome = join(tempRoot, ".tyrum");
        mkdirSync(tyrumHome, { recursive: true });
        const dbPath = join(tempRoot, "gateway.db");

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

        try {
          const healthUrl = `http://127.0.0.1:${port}/healthz`;
          await waitForGatewayHealth(healthUrl, child, output);
          const tenantAdminToken = extractBootstrapToken(stdout, "default-tenant-admin");

          const db = new Database(dbPath);
          try {
            db.pragma("journal_mode = WAL");
            db.pragma("foreign_keys = ON");
            db.pragma("busy_timeout = 5000");

            const nowIso = new Date().toISOString();
            const jobId = "a8c8b7d6-e3f5-4b3c-a1c8-1c4c5c2f0a01";
            const runId = "c8b7d6e3-f54b-4b3c-a1c8-1c4c5c2f0a02";
            const stepId = "d6e3f54b-4b3c-4b3c-a1c8-1c4c5c2f0a03";
            const resumeToken = "resume-ws-approval-test";
            const approvalId = "e3f54b4b-3c4b-4b3c-a1c8-1c4c5c2f0a04";
            const approvalKey = "approval-ws-approval-test";
            const key = "test:ws-approval";
            const lane = "main";
            const triggerJson = JSON.stringify({ kind: "session", key, lane });
            const actionJson = JSON.stringify({ type: "Decide", args: {} });
            const contextJson = JSON.stringify({ source: "agent-tool-execution" });

            db.prepare(
              `INSERT INTO execution_jobs (
	                 tenant_id,
	                 job_id,
	                 agent_id,
	                 workspace_id,
	                 key,
	                 lane,
	                 status,
	                 trigger_json,
	                 created_at
	               ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
            ).run(
              DEFAULT_TENANT_ID,
              jobId,
              DEFAULT_AGENT_ID,
              DEFAULT_WORKSPACE_ID,
              key,
              lane,
              triggerJson,
              nowIso,
            );

            db.prepare(
              `INSERT INTO execution_runs (
	                 tenant_id,
	                 run_id,
	                 job_id,
	                 key,
	                 lane,
	                 status,
	                 attempt,
	                 created_at,
	                 started_at,
	                 paused_reason,
	                 paused_detail
	               ) VALUES (?, ?, ?, ?, ?, 'paused', 1, ?, ?, 'approval', 'waiting on approval')`,
            ).run(DEFAULT_TENANT_ID, runId, jobId, key, lane, nowIso, nowIso);

            db.prepare(
              `INSERT INTO resume_tokens (tenant_id, token, run_id, created_at)
	               VALUES (?, ?, ?, ?)`,
            ).run(DEFAULT_TENANT_ID, resumeToken, runId, nowIso);

            db.prepare(
              `INSERT INTO approvals (
	                 tenant_id,
	                 approval_id,
	                 approval_key,
	                 agent_id,
	                 workspace_id,
	                 kind,
	                 status,
	                 prompt,
	                 context_json,
	                 created_at,
	                 expires_at,
	                 run_id,
	                 step_id,
	                 resume_token
	               ) VALUES (?, ?, ?, ?, ?, 'workflow_step', 'pending', ?, ?, ?, NULL, ?, ?, ?)`,
            ).run(
              DEFAULT_TENANT_ID,
              approvalId,
              approvalKey,
              DEFAULT_AGENT_ID,
              DEFAULT_WORKSPACE_ID,
              "test approval",
              contextJson,
              nowIso,
              runId,
              stepId,
              resumeToken,
            );

            db.prepare(
              `INSERT INTO execution_steps (
	                 tenant_id,
	                 step_id,
	                 run_id,
	                 step_index,
	                 status,
	                 action_json,
	                 created_at,
	                 approval_id
	               ) VALUES (?, ?, ?, 0, 'paused', ?, ?, ?)`,
            ).run(DEFAULT_TENANT_ID, stepId, runId, actionJson, nowIso, approvalId);

            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(tenantAdminToken));
            try {
              await waitForOpen(ws);
              await completeHandshake(ws, {
                requestIdPrefix: "r",
                role: "client",
                capabilities: [],
              });

              ws.send(
                JSON.stringify({
                  request_id: `approval-${approvalId}`,
                  type: "approval.request",
                  ok: true,
                  result: { approved: false, reason: "denied in ws test" },
                }),
              );

              const deadline = Date.now() + 5_000;
              let status: string | undefined;
              let pausedReason: string | null | undefined;

              while (Date.now() < deadline) {
                const row = db
                  .prepare("SELECT status, paused_reason FROM execution_runs WHERE run_id = ?")
                  .get(runId) as { status?: string; paused_reason?: string | null } | undefined;
                status = row?.status;
                pausedReason = row?.paused_reason;
                if (status && status !== "paused") break;
                await delay(25);
              }

              expect(status).not.toBe("cancelled");
              expect(pausedReason ?? null).toBeNull();
            } finally {
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
              }
            }
          } finally {
            db.close();
          }
        } finally {
          await stopChildProcess(child);
          rmSync(tempRoot, { recursive: true, force: true });
        }
      } finally {
        releaseBuildLock();
      }
    },
  );

  it(
    "cancels runs when an approval is approved but missing a resume token over WebSocket",
    { timeout: 180_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();

        const port = await findAvailablePort();
        const tempRoot = mkdtempSync(join(tmpdir(), "tyrum-gateway-ws-approval-missing-token-"));
        const tyrumHome = join(tempRoot, ".tyrum");
        mkdirSync(tyrumHome, { recursive: true });
        const dbPath = join(tempRoot, "gateway.db");

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

        try {
          const healthUrl = `http://127.0.0.1:${port}/healthz`;
          await waitForGatewayHealth(healthUrl, child, output);
          const tenantAdminToken = extractBootstrapToken(stdout, "default-tenant-admin");

          const db = new Database(dbPath);
          try {
            db.pragma("journal_mode = WAL");
            db.pragma("foreign_keys = ON");
            db.pragma("busy_timeout = 5000");

            const nowIso = new Date().toISOString();
            const jobId = "c78e8356-6c13-4f74-92d8-3386da3fbf01";
            const runId = "6c13c78e-8356-4f74-92d8-3386da3fbf02";
            const stepId = "83566c13-c78e-4f74-92d8-3386da3fbf03";
            const approvalId = "8e83566c-13c7-4f74-92d8-3386da3fbf04";
            const approvalKey = "approval-ws-approval-missing-token";
            const key = "test:ws-approval-missing-token";
            const lane = "main";
            const triggerJson = JSON.stringify({ kind: "session", key, lane });
            const actionJson = JSON.stringify({ type: "Decide", args: {} });
            const contextJson = JSON.stringify({ source: "agent-tool-execution" });

            db.prepare(
              `INSERT INTO execution_jobs (
	                 tenant_id,
	                 job_id,
	                 agent_id,
	                 workspace_id,
	                 key,
	                 lane,
	                 status,
	                 trigger_json,
	                 created_at
	               ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
            ).run(
              DEFAULT_TENANT_ID,
              jobId,
              DEFAULT_AGENT_ID,
              DEFAULT_WORKSPACE_ID,
              key,
              lane,
              triggerJson,
              nowIso,
            );

            db.prepare(
              `INSERT INTO execution_runs (
	                 tenant_id,
	                 run_id,
	                 job_id,
	                 key,
	                 lane,
	                 status,
	                 attempt,
	                 created_at,
	                 started_at,
	                 paused_reason,
	                 paused_detail
	               ) VALUES (?, ?, ?, ?, ?, 'paused', 1, ?, ?, 'approval', 'waiting on approval')`,
            ).run(DEFAULT_TENANT_ID, runId, jobId, key, lane, nowIso, nowIso);

            db.prepare(
              `INSERT INTO approvals (
	                 tenant_id,
	                 approval_id,
	                 approval_key,
	                 agent_id,
	                 workspace_id,
	                 kind,
	                 status,
	                 prompt,
	                 context_json,
	                 created_at,
	                 expires_at,
	                 run_id,
	                 step_id,
	                 resume_token
	               ) VALUES (?, ?, ?, ?, ?, 'workflow_step', 'pending', ?, ?, ?, NULL, ?, ?, NULL)`,
            ).run(
              DEFAULT_TENANT_ID,
              approvalId,
              approvalKey,
              DEFAULT_AGENT_ID,
              DEFAULT_WORKSPACE_ID,
              "test approval",
              contextJson,
              nowIso,
              runId,
              stepId,
            );

            db.prepare(
              `INSERT INTO execution_steps (
	                 tenant_id,
	                 step_id,
	                 run_id,
	                 step_index,
	                 status,
	                 action_json,
	                 created_at,
	                 approval_id
	               ) VALUES (?, ?, ?, 0, 'paused', ?, ?, ?)`,
            ).run(DEFAULT_TENANT_ID, stepId, runId, actionJson, nowIso, approvalId);

            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(tenantAdminToken));
            try {
              await waitForOpen(ws);
              await completeHandshake(ws, {
                requestIdPrefix: "r",
                role: "client",
                capabilities: [],
              });

              ws.send(
                JSON.stringify({
                  request_id: `approval-${approvalId}`,
                  type: "approval.request",
                  ok: true,
                  result: { approved: true, reason: "approved in ws test (missing resume token)" },
                }),
              );

              const deadline = Date.now() + 5_000;
              let status: string | undefined;

              while (Date.now() < deadline) {
                const row = db
                  .prepare("SELECT status FROM execution_runs WHERE run_id = ?")
                  .get(runId) as { status?: string } | undefined;
                status = row?.status;
                if (status === "cancelled") break;
                await delay(25);
              }

              expect(status, output()).toBe("cancelled");
            } finally {
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
              }
            }
          } finally {
            db.close();
          }
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
    { timeout: 180_000 },
    async () => {
      let releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
        releaseBuildLock();
        releaseBuildLock = () => {};

        const port = await findAvailablePort();
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

          const trigger = JSON.parse(row.trigger_json) as {
            kind?: string;
            metadata?: Record<string, unknown>;
          };
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
    { timeout: 180_000 },
    async () => {
      let releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
        releaseBuildLock();
        releaseBuildLock = () => {};

        const port = await findAvailablePort();
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

          const trigger = JSON.parse(row.trigger_json) as {
            kind?: string;
            metadata?: Record<string, unknown>;
          };
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
