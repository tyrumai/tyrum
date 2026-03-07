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
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { NodeDispatchService } from "../../src/modules/agent/node-dispatch-service.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import {
  cleanupDockerContainer,
  delay,
  dockerAvailable,
  ensureDesktopSandboxImage,
  type ExecutionScopeIds,
  readDockerLogs,
  resolveDesktopSandboxImageTag,
  runZenityA11ySmoke,
  seedExecutionScope,
  startDesktopSandboxContainer,
  stubMcpManager,
  waitForNoVncReady,
  waitForPendingDesktopPairing,
} from "./desktop-sandbox-e2e-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const CAN_RUN_DESKTOP_SANDBOX_E2E = process.platform === "linux" && dockerAvailable();

describe("e2e: tool.node.dispatch against docker desktop-sandbox", () => {
  it.skipIf(!CAN_RUN_DESKTOP_SANDBOX_E2E)(
    "dispatches Desktop snapshot + mouse move and stores screenshot as a fetchable artifact",
    { timeout: 15 * 60_000 },
    async () => {
      const tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-desktop-sandbox-e2e-"));

      let httpServer: Server | undefined;
      let stopHeartbeat: (() => void) | undefined;
      let containerId: string | undefined;
      let containerName: string | undefined;

      try {
        const imageTag = resolveDesktopSandboxImageTag();
        ensureDesktopSandboxImage(imageTag, REPO_ROOT);

        const container = createContainer({
          dbPath: ":memory:",
          migrationsDir,
          tyrumHome,
        });
        const authTokens = new AuthTokenService(container.db);
        const issued = await authTokens.issueToken({
          tenantId: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: ["*"],
        });
        const adminToken = issued.token;
        const app = createApp(container, { authTokens });

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
          authTokens,
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
        containerId = startDesktopSandboxContainer({
          adminToken,
          containerName,
          gatewayPort,
          imageTag,
        });

        if (!containerName) throw new Error("desktop-sandbox container name missing");
        await waitForNoVncReady(containerName, 60_000);

        try {
          const pairing = await waitForPendingDesktopPairing({
            listPending: async () => {
              const pending = await container.nodePairingDal.list({
                tenantId: DEFAULT_TENANT_ID,
                status: "pending",
                limit: 25,
              });
              return pending.map((p) => ({
                pairing_id: p.pairing_id,
                node: { capabilities: p.node.capabilities as unknown as string[] },
              }));
            },
            timeoutMs: 90_000,
          });

          const desktopDescriptorId = descriptorIdForClientCapability("desktop");
          await container.nodePairingDal.resolve({
            tenantId: DEFAULT_TENANT_ID,
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
              tenantId: DEFAULT_TENANT_ID,
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
            { headers: { authorization: `Bearer ${adminToken}` } },
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
            { headers: { authorization: `Bearer ${adminToken}` } },
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
                tenantId: DEFAULT_TENANT_ID,
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

          await runZenityA11ySmoke({
            containerName,
            nodeDispatchService,
            scope,
          });

          await container.db.close();
        } catch (err) {
          const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
          const details = [
            message,
            containerName
              ? `--- docker logs (${containerName}) ---\n${readDockerLogs(containerName)}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n");
          throw new Error(details, { cause: err as Error });
        }
      } finally {
        cleanupDockerContainer({ containerName, containerId });

        stopHeartbeat?.();

        if (httpServer) {
          await new Promise<void>((resolveClose) => httpServer!.close(() => resolveClose()));
          httpServer = undefined;
        }

        await rm(tyrumHome, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );
});
