import { spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getRequestListener } from "@hono/node-server";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";

import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { NodeDispatchService } from "../../src/modules/agent/node-dispatch-service.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";

import { seedExecutionScope, type ExecutionScopeIds } from "./execution-scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const DOCKER_INFO_TIMEOUT_MS = 15_000;
const DOCKER_IMAGE_INSPECT_TIMEOUT_MS = 15_000;
const DOCKER_BUILD_TIMEOUT_MS = 10 * 60_000;
const DOCKER_RUN_TIMEOUT_MS = 60_000;
const DOCKER_LOGS_TIMEOUT_MS = 30_000;
const DOCKER_CLEANUP_TIMEOUT_MS = 30_000;
const DOCKER_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type DockerResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  signal?: NodeJS.Signals | null;
};

function runDocker(
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBufferBytes?: number },
): DockerResult {
  const result = spawnSync("docker", args, {
    cwd: opts?.cwd,
    env: opts?.env,
    encoding: "utf8",
    timeout: opts?.timeoutMs,
    maxBuffer: opts?.maxBufferBytes ?? DOCKER_MAX_BUFFER_BYTES,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
    signal: result.signal,
  };
}

function dockerAvailable(): boolean {
  const result = runDocker(["info"], { timeoutMs: DOCKER_INFO_TIMEOUT_MS });
  return result.status === 0;
}

function dockerImageExists(tag: string): boolean {
  const result = runDocker(["image", "inspect", tag], {
    timeoutMs: DOCKER_IMAGE_INSPECT_TIMEOUT_MS,
  });
  return result.status === 0;
}

function assertDockerOk(result: DockerResult, hint: string): void {
  if (result.status === 0) return;
  const signal = result.signal ? `signal=${result.signal}` : undefined;
  throw new Error(
    [hint, result.error, signal, result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

function stubMcpManager(): McpManager {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  } as unknown as McpManager;
}

async function waitForPendingDesktopPairing(params: {
  listPending: () => Promise<Array<{ pairing_id: number; node: { capabilities: string[] } }>>;
  timeoutMs?: number;
}): Promise<{ pairing_id: number }> {
  const deadlineMs = Date.now() + Math.max(1, Math.floor(params.timeoutMs ?? 60_000));
  while (Date.now() < deadlineMs) {
    const pairings = await params.listPending();
    const pairing = pairings.find(
      (p) => Array.isArray(p.node.capabilities) && p.node.capabilities.includes("desktop"),
    );
    if (pairing) return pairing;
    await delay(250);
  }
  throw new Error("timed out waiting for pending desktop pairing");
}

const CAN_RUN_DESKTOP_SANDBOX_E2E = process.platform === "linux" && dockerAvailable();

describe("e2e: tool.node.dispatch against docker desktop-sandbox", () => {
  it.skipIf(!CAN_RUN_DESKTOP_SANDBOX_E2E)(
    "dispatches Desktop snapshot + mouse move and stores screenshot as a fetchable artifact",
    { timeout: 15 * 60_000 },
    async () => {
      const tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-desktop-sandbox-e2e-"));
      const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-desktop-sandbox-token-"));

      let httpServer: Server | undefined;
      let stopHeartbeat: (() => void) | undefined;
      let containerId: string | undefined;
      let containerName: string | undefined;

      try {
        const imageTag =
          process.env["TYRUM_DESKTOP_SANDBOX_IMAGE"]?.trim() || "tyrum-desktop-sandbox-e2e:local";
        const shouldBuild =
          process.env["CI"] === "true" ||
          process.env["TYRUM_DESKTOP_SANDBOX_REBUILD"] === "1" ||
          !dockerImageExists(imageTag);

        if (shouldBuild) {
          const build = runDocker(
            ["build", "-f", "docker/desktop-sandbox/Dockerfile", "-t", imageTag, "."],
            { cwd: REPO_ROOT, timeoutMs: DOCKER_BUILD_TIMEOUT_MS },
          );
          assertDockerOk(build, "Failed to build desktop-sandbox image for e2e test.");
        }

        const tokenStore = new TokenStore(tokenHome);
        const adminToken = await tokenStore.initialize();

        const container = createContainer({
          dbPath: ":memory:",
          migrationsDir,
          tyrumHome,
        });
        const app = createApp(container);

        const connectionManager = new ConnectionManager();
        const taskResults = new TaskResultRegistry();

        const protocolDeps: ProtocolDeps = {
          connectionManager,
          db: container.db,
          logger: container.logger,
          taskResults,
          nodePairingDal: container.nodePairingDal,
          onTaskResult(taskId, success, evidence, error) {
            taskResults.resolve(
              taskId,
              success ? { ok: true, evidence } : { ok: false, evidence, error },
            );
          },
          onConnectionClosed(connectionId) {
            taskResults.rejectAllForConnection(connectionId);
          },
        };

        const wsHandler = createWsHandler({
          connectionManager,
          protocolDeps,
          tokenStore,
          nodePairingDal: container.nodePairingDal,
        });
        stopHeartbeat = wsHandler.stopHeartbeat;

        const requestListener = getRequestListener(app.fetch);
        httpServer = createHttpServer(requestListener);
        httpServer.on("upgrade", (req, socket, head) => {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (pathname === "/ws") {
            wsHandler.handleUpgrade(req, socket, head);
          } else {
            socket.destroy();
          }
        });

        const gatewayPort = await new Promise<number>((resolvePort) => {
          httpServer!.listen(0, "0.0.0.0", () => {
            const address = httpServer!.address();
            resolvePort(typeof address === "object" && address ? address.port : 0);
          });
        });
        if (!gatewayPort) throw new Error("failed to allocate gateway port");

        containerName = `tyrum-desktop-sandbox-e2e-${randomUUID().slice(0, 8)}`;

        const runArgsBase = [
          "run",
          "--detach",
          "--name",
          containerName,
          "-e",
          `TYRUM_GATEWAY_TOKEN=${adminToken}`,
          "-e",
          "TYRUM_NODE_LABEL=tyrum-desktop-sandbox-e2e",
          "-e",
          "TYRUM_NODE_MODE=desktop-sandbox",
        ];
        const wsUrlViaHostGateway = `ws://host.containers.internal:${gatewayPort}/ws`;
        const wsUrlViaHostNetwork = `ws://127.0.0.1:${gatewayPort}/ws`;

        let run = runDocker(
          [
            ...runArgsBase,
            "-e",
            `TYRUM_GATEWAY_WS_URL=${wsUrlViaHostGateway}`,
            "--add-host",
            "host.containers.internal:host-gateway",
            imageTag,
          ],
          { timeoutMs: DOCKER_RUN_TIMEOUT_MS },
        );
        if (run.status !== 0) {
          const combined = (run.stdout + run.stderr).toLowerCase();
          if (combined.includes("host-gateway")) {
            const fallback = runDocker(
              [
                ...runArgsBase,
                "--network",
                "host",
                "-e",
                `TYRUM_GATEWAY_WS_URL=${wsUrlViaHostNetwork}`,
                imageTag,
              ],
              { timeoutMs: DOCKER_RUN_TIMEOUT_MS },
            );
            if (fallback.status === 0) {
              run = fallback;
            } else {
              assertDockerOk(
                fallback,
                "Failed to start desktop-sandbox container (fallback to --network host).",
              );
            }
          } else {
            assertDockerOk(run, "Failed to start desktop-sandbox container.");
          }
        }

        containerId = run.stdout.trim();
        if (!containerId) {
          throw new Error(`desktop-sandbox container did not return an id: ${run.stdout}`);
        }

        try {
          const pairing = await waitForPendingDesktopPairing({
            listPending: async () => {
              const pending = await container.nodePairingDal.list({ status: "pending", limit: 25 });
              return pending.map((p) => ({
                pairing_id: p.pairing_id,
                node: { capabilities: p.node.capabilities as unknown as string[] },
              }));
            },
            timeoutMs: 90_000,
          });

          const desktopDescriptorId = descriptorIdForClientCapability("desktop");
          await container.nodePairingDal.resolve({
            pairingId: pairing.pairing_id,
            decision: "approved",
            trustLevel: "local",
            capabilityAllowlist: [
              {
                id: desktopDescriptorId,
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          });

          const scope: ExecutionScopeIds = {
            jobId: randomUUID(),
            runId: randomUUID(),
            stepId: randomUUID(),
            attemptId: randomUUID(),
          };
          await seedExecutionScope(container.db, scope);

          const nodeDispatchService = new NodeDispatchService(protocolDeps);
          const executor = new ToolExecutor(
            tyrumHome,
            stubMcpManager(),
            new Map(),
            fetch,
            undefined,
            undefined,
            container.redactionEngine,
            undefined,
            {
              db: container.db,
              workspaceId: "default",
              ownerPrefix: "test-tool",
            },
            nodeDispatchService,
            container.artifactStore as any,
          );

          const snapshotResult = await executor.execute(
            "tool.node.dispatch",
            "call-1",
            {
              capability: "tyrum.desktop",
              action: "Desktop",
              args: { op: "snapshot", include_tree: false },
              timeout_ms: 120_000,
            },
            {
              execution_run_id: scope.runId,
              execution_step_id: scope.stepId,
            },
          );

          expect(snapshotResult.error).toBeUndefined();
          expect(snapshotResult.output).toContain('"ok":true');
          expect(snapshotResult.output).toContain("artifact://");
          expect(snapshotResult.output).not.toContain("bytesBase64");

          const artifactRow = await container.db.get<{
            artifact_id: string;
            run_id: string | null;
            step_id: string | null;
            attempt_id: string | null;
          }>(
            `SELECT artifact_id, run_id, step_id, attempt_id
             FROM execution_artifacts
             WHERE run_id = ? AND step_id = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [scope.runId, scope.stepId],
          );
          expect(artifactRow).toBeTruthy();
          expect(artifactRow?.attempt_id).toBe(scope.attemptId);

          const artifactRes = await app.request(
            `/runs/${scope.runId}/artifacts/${artifactRow!.artifact_id}`,
          );
          expect(artifactRes.status).toBe(200);
          expect(artifactRes.headers.get("content-type")).toBe("image/png");
          expect(Buffer.from(await artifactRes.arrayBuffer()).length).toBeGreaterThan(0);

          const actResult = await executor.execute(
            "tool.node.dispatch",
            "call-2",
            {
              capability: "tyrum.desktop",
              action: "Desktop",
              args: { op: "mouse", action: "move", x: 5, y: 5 },
              timeout_ms: 60_000,
            },
            {
              execution_run_id: scope.runId,
              execution_step_id: scope.stepId,
            },
          );

          expect(actResult.error).toBeUndefined();
          expect(actResult.output).toContain('"ok":true');

          await container.db.close();
        } catch (err) {
          const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
          const logs = containerName
            ? runDocker(["logs", containerName], { timeoutMs: DOCKER_LOGS_TIMEOUT_MS })
            : undefined;
          const details = [
            message,
            logs
              ? `--- docker logs (${containerName}) ---\n${truncate(logs.stdout + logs.stderr, 16_000)}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n");
          throw new Error(details, { cause: err as Error });
        }
      } finally {
        if (containerName) {
          runDocker(["stop", containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
          runDocker(["rm", "-f", containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
        } else if (containerId) {
          runDocker(["stop", containerId], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
          runDocker(["rm", "-f", containerId], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
        }

        stopHeartbeat?.();

        if (httpServer) {
          await new Promise<void>((resolveClose) => httpServer!.close(() => resolveClose()));
          httpServer = undefined;
        }

        await rm(tokenHome, { recursive: true, force: true }).catch(() => undefined);
        await rm(tyrumHome, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );
});
