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
  type DesktopQueryMatch,
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
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

async function seedExecutionScope(db: SqlRunner, ids: ExecutionScopeIds): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      ids.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:agent-1:thread:thread-1",
      "main",
      "{}",
      "{}",
      ids.runId,
    ],
  );

  await db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'running', 1)`,
    [DEFAULT_TENANT_ID, ids.runId, ids.jobId, "agent:agent-1:thread:thread-1", "main"],
  );

  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [DEFAULT_TENANT_ID, ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, ?, 1, 'running', '[]')`,
    [DEFAULT_TENANT_ID, ids.attemptId, ids.stepId],
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const DOCKER_INFO_TIMEOUT_MS = 15_000;
const DOCKER_IMAGE_INSPECT_TIMEOUT_MS = 15_000;
const DOCKER_BUILD_TIMEOUT_MS = 10 * 60_000;
const DOCKER_RUN_TIMEOUT_MS = 60_000;
const DOCKER_LOGS_TIMEOUT_MS = 30_000;
const DOCKER_EXEC_TIMEOUT_MS = 10_000;
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

async function waitForNoVncReady(containerName: string, timeoutMs: number): Promise<void> {
  const deadlineMs = Date.now() + Math.max(1, Math.floor(timeoutMs));
  while (Date.now() < deadlineMs) {
    const result = runDocker(
      [
        "exec",
        containerName,
        "bash",
        "-lc",
        'curl -fsS "http://127.0.0.1:6080/vnc.html" >/dev/null',
      ],
      { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
    );
    if (result.status === 0) return;
    await delay(500);
  }

  const logResult = runDocker(
    ["exec", containerName, "bash", "-lc", "tail -n 50 /tmp/novnc.log 2>/dev/null || true"],
    { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
  );

  throw new Error(
    [
      "noVNC did not become ready inside desktop-sandbox container.",
      truncate(logResult.stdout + logResult.stderr, 4_000),
    ]
      .filter(Boolean)
      .join("\n"),
  );
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
          onTaskResult(taskId, success, result, evidence, error) {
            taskResults.resolve(
              taskId,
              success ? { ok: true, result, evidence } : { ok: false, result, evidence, error },
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

        if (!containerName) throw new Error("desktop-sandbox container name missing");
        await waitForNoVncReady(containerName, 60_000);

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
              workspaceId: DEFAULT_WORKSPACE_ID,
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
              args: { op: "snapshot", include_tree: true, max_nodes: 512, max_text_chars: 8192 },
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
          expect(snapshotResult.output).toContain("tree_artifact");
          expect(snapshotResult.output).not.toContain("bytesBase64");

          const artifactRow = await container.db.get<{
            artifact_id: string;
            run_id: string | null;
            step_id: string | null;
            attempt_id: string | null;
          }>(
            `SELECT artifact_id, run_id, step_id, attempt_id
	             FROM execution_artifacts
	             WHERE run_id = ? AND step_id = ? AND kind = 'screenshot'
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

          const treeRow = await container.db.get<{
            artifact_id: string;
          }>(
            `SELECT artifact_id
	             FROM execution_artifacts
	             WHERE run_id = ? AND step_id = ? AND kind = 'dom_snapshot'
	             ORDER BY created_at DESC
	             LIMIT 1`,
            [scope.runId, scope.stepId],
          );
          expect(treeRow).toBeTruthy();

          const treeRes = await app.request(
            `/runs/${scope.runId}/artifacts/${treeRow!.artifact_id}`,
          );
          expect(treeRes.status).toBe(200);
          expect(treeRes.headers.get("content-type")).toBe("application/json");
          const treeJson = (await treeRes.json()) as { root?: { role?: unknown } } | undefined;
          expect(treeJson?.root?.role).toEqual(expect.any(String));

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

          const extractMatches = (result: {
            ok: boolean;
            result?: unknown;
          }): DesktopQueryMatch[] => {
            if (!result.ok) return [];
            const payload = result.result as { matches?: unknown } | undefined;
            return Array.isArray(payload?.matches) ? (payload?.matches as DesktopQueryMatch[]) : [];
          };

          const queryDeadlineMs = Date.now() + 30_000;
          for (;;) {
            const query = await nodeDispatchService.dispatchAndWait(
              {
                type: "Desktop",
                args: {
                  op: "query",
                  selector: { kind: "a11y", role: "desktop frame" },
                  limit: 1,
                },
              },
              {
                runId: scope.runId,
                stepId: scope.stepId,
                attemptId: scope.attemptId,
              },
              { timeoutMs: 60_000 },
            );

            const matches = extractMatches(query.result);
            if (matches.length > 0) {
              expect(matches[0]?.kind).toBe("a11y");
              expect(matches[0]?.node?.role).toBe("desktop frame");
              break;
            }

            if (Date.now() > queryDeadlineMs) {
              const message = query.result.error
                ? `Desktop a11y query error: ${query.result.error}`
                : "Desktop a11y query returned no matches.";
              throw new Error(message);
            }

            await delay(500);
          }

          const hasZenity =
            runDocker(["exec", containerName, "bash", "-lc", "command -v zenity >/dev/null 2>&1"], {
              timeoutMs: DOCKER_EXEC_TIMEOUT_MS,
            }).status === 0;

          if (hasZenity) {
            const okLabel = "Tyrum A11y OK";

            const startDialog = runDocker(
              [
                "exec",
                containerName,
                "bash",
                "-lc",
                [
                  "DISPLAY=:0",
                  "zenity --question",
                  '--title "Tyrum A11y Smoke"',
                  '--text "AT-SPI click smoke"',
                  `--ok-label "${okLabel}"`,
                  '--cancel-label "Tyrum A11y Cancel"',
                  ">/tmp/tyrum-zenity.log 2>&1 &",
                ].join(" "),
              ],
              { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
            );
            assertDockerOk(
              startDialog,
              "Failed to start zenity dialog inside desktop-sandbox container.",
            );

            const clickByRef = async (elementRef: string): Promise<void> => {
              const click = await nodeDispatchService.dispatchAndWait(
                {
                  type: "Desktop",
                  args: {
                    op: "act",
                    target: { kind: "ref", ref: elementRef },
                    action: { kind: "click" },
                  },
                },
                {
                  runId: scope.runId,
                  stepId: scope.stepId,
                  attemptId: scope.attemptId,
                },
                { timeoutMs: 60_000 },
              );
              if (!click.result.ok) {
                throw new Error(
                  `Desktop a11y act(click) failed: ${click.result.error ?? "<missing>"}`,
                );
              }
            };

            const okButtonQueryDeadlineMs = Date.now() + 10_000;
            let okButton: (DesktopQueryMatch & { kind: "a11y" }) | undefined;
            for (;;) {
              const query = await nodeDispatchService.dispatchAndWait(
                {
                  type: "Desktop",
                  args: {
                    op: "query",
                    selector: { kind: "a11y", role: "push button", name: okLabel },
                    limit: 1,
                  },
                },
                {
                  runId: scope.runId,
                  stepId: scope.stepId,
                  attemptId: scope.attemptId,
                },
                { timeoutMs: 60_000 },
              );

              const match = extractMatches(query.result)[0];
              if (match?.kind === "a11y") {
                okButton = match;
                break;
              }

              if (Date.now() > okButtonQueryDeadlineMs) break;
              await delay(500);
            }

            if (okButton) {
              expect(okButton.node.name.toLowerCase()).toContain(okLabel.toLowerCase());
              await clickByRef(okButton.element_ref);
            } else {
              const dialogDeadlineMs = Date.now() + 30_000;
              let dialog: (DesktopQueryMatch & { kind: "a11y" }) | undefined;
              for (;;) {
                const query = await nodeDispatchService.dispatchAndWait(
                  {
                    type: "Desktop",
                    args: {
                      op: "query",
                      selector: { kind: "a11y", role: "dialog", states: ["active"] },
                      limit: 1,
                    },
                  },
                  {
                    runId: scope.runId,
                    stepId: scope.stepId,
                    attemptId: scope.attemptId,
                  },
                  { timeoutMs: 60_000 },
                );

                const match = extractMatches(query.result)[0];
                if (match?.kind === "a11y") {
                  dialog = match;
                  break;
                }

                if (Date.now() > dialogDeadlineMs) {
                  throw new Error(
                    "Desktop a11y could not locate active dialog after starting zenity.",
                  );
                }

                await delay(500);
              }

              const dialogBounds = dialog.node.bounds;
              const containsBounds = (
                outer: { x: number; y: number; width: number; height: number },
                inner: { x: number; y: number; width: number; height: number },
              ): boolean => {
                if (inner.width <= 0 || inner.height <= 0) return false;
                const outerRight = outer.x + outer.width;
                const outerBottom = outer.y + outer.height;
                const innerRight = inner.x + inner.width;
                const innerBottom = inner.y + inner.height;
                return (
                  inner.x >= outer.x &&
                  inner.y >= outer.y &&
                  innerRight <= outerRight &&
                  innerBottom <= outerBottom
                );
              };

              const buttonDeadlineMs = Date.now() + 30_000;
              let buttonCandidates: Array<DesktopQueryMatch & { kind: "a11y" }> = [];
              for (;;) {
                const query = await nodeDispatchService.dispatchAndWait(
                  {
                    type: "Desktop",
                    args: {
                      op: "query",
                      selector: { kind: "a11y", role: "push button" },
                      limit: 64,
                    },
                  },
                  {
                    runId: scope.runId,
                    stepId: scope.stepId,
                    attemptId: scope.attemptId,
                  },
                  { timeoutMs: 60_000 },
                );

                const candidates = extractMatches(query.result).filter(
                  (match): match is DesktopQueryMatch & { kind: "a11y" } => match.kind === "a11y",
                );

                buttonCandidates = candidates.filter((match) =>
                  containsBounds(dialogBounds, match.node.bounds),
                );
                if (buttonCandidates.length > 0) break;

                if (Date.now() > buttonDeadlineMs) {
                  throw new Error("Desktop a11y could not locate a dialog button to click.");
                }

                await delay(500);
              }

              const defaultButton = buttonCandidates.find((candidate) =>
                candidate.node.states.some((state) => state.trim().toLowerCase() === "is_default"),
              );
              const chosen =
                defaultButton ??
                [...buttonCandidates].sort((a, b) => b.node.bounds.x - a.node.bounds.x)[0];

              if (!chosen)
                throw new Error("Desktop a11y could not locate a dialog button to click.");
              await clickByRef(chosen.element_ref);
            }

            const closeDeadlineMs = Date.now() + 30_000;
            for (;;) {
              const ps = runDocker(
                [
                  "exec",
                  containerName,
                  "bash",
                  "-lc",
                  "command -v ps >/dev/null 2>&1 && ps -eo pid,args | grep -i zenity | grep -v grep || true",
                ],
                { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
              );
              const stillRunning = (ps.stdout + ps.stderr).trim().length > 0;
              if (!stillRunning) break;

              if (Date.now() > closeDeadlineMs) {
                const zenityLog = runDocker(
                  [
                    "exec",
                    containerName,
                    "bash",
                    "-lc",
                    "tail -n 200 /tmp/tyrum-zenity.log 2>/dev/null || true",
                  ],
                  { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
                );
                throw new Error(
                  [
                    "Desktop a11y click did not dismiss zenity dialog in time.",
                    "--- /tmp/tyrum-zenity.log ---",
                    truncate(zenityLog.stdout + zenityLog.stderr, 4_000),
                  ].join("\n"),
                );
              }

              await delay(500);
            }
          }

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
