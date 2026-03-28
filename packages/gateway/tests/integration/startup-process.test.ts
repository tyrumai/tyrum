import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { completeHandshake } from "./ws-handshake.js";
import {
  openTestDatabase,
  readLatestHookRun,
  readLatestHookRunWithPause,
  seedDeploymentPolicyBundle,
  seedLifecycleHooksConfig,
  seedPausedApprovalRun,
  waitForExecutionRunKeyStatus,
  waitForExecutionRunStatus,
  waitForExecutionRunToLeavePaused,
} from "./startup-process.test-support.js";
import {
  authProtocols,
  startGatewayFixture,
  waitForOpen,
  withGatewayBuild,
} from "./startup-process.gateway-support.js";
import {
  busyShutdownHookKey,
  busyShutdownHookConversationKey,
  busyShutdownHookDefinitions,
  busyShutdownPolicyBundle,
  busyStartHookKey,
  busyStartHookConversationKey,
  deniedApprovalFixture,
  missingResumeTokenApprovalFixture,
  shutdownHookDefinition,
  shutdownHookKey,
  shutdownHookConversationKey,
} from "./startup-process.fixtures.js";

describe("gateway startup process", () => {
  it(
    "starts the real gateway and serves /healthz and /agent/status",
    { timeout: 300_000 },
    async () => {
      await withGatewayBuild(
        async () => {
          const gateway = await startGatewayFixture({ tempPrefix: "tyrum-gateway-startup-" });
          const agentStatusUrl = `http://127.0.0.1:${gateway.port}/agent/status`;
          try {
            const healthResponse = await fetch(gateway.healthUrl);
            expect(healthResponse.status).toBe(200);
            const healthBody = (await healthResponse.json()) as { status: string };
            expect(healthBody.status).toBe("ok");

            const agentStatusResponse = await fetch(agentStatusUrl, {
              headers: {
                Authorization: `Bearer ${gateway.tenantAdminToken}`,
              },
            });
            expect(agentStatusResponse.status).toBe(200);
            const agentStatusBody = (await agentStatusResponse.json()) as {
              enabled: boolean;
            };
            expect(agentStatusBody.enabled).toBe(true);
          } finally {
            await gateway.stopAndCleanup();
          }
        },
        { releaseAfterBuild: true },
      );
    },
  );

  it(
    "resumes agent tool-execution runs on denied approvals over WebSocket",
    { timeout: 180_000 },
    async () => {
      await withGatewayBuild(
        async () => {
          const gateway = await startGatewayFixture({ tempPrefix: "tyrum-gateway-ws-approval-" });
          try {
            const db = openTestDatabase(gateway.dbPath);
            try {
              seedPausedApprovalRun(db, deniedApprovalFixture);

              const ws = new WebSocket(
                `ws://127.0.0.1:${gateway.port}/ws`,
                authProtocols(gateway.tenantAdminToken),
              );
              try {
                await waitForOpen(ws);
                await completeHandshake(ws, {
                  requestIdPrefix: "r",
                  role: "client",
                  capabilities: [],
                });

                ws.send(
                  JSON.stringify({
                    request_id: `approval-${deniedApprovalFixture.approvalId}`,
                    type: "approval.resolve",
                    payload: {
                      approval_id: deniedApprovalFixture.approvalId,
                      decision: "denied",
                      reason: "denied in ws test",
                    },
                  }),
                );

                const turnState = await waitForExecutionRunToLeavePaused(
                  db,
                  deniedApprovalFixture.runId,
                );
                expect(turnState.status).not.toBe("cancelled");
                expect(turnState.pausedReason ?? null).toBeNull();
              } finally {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                  ws.close();
                }
              }
            } finally {
              db.close();
            }
          } finally {
            await gateway.stopAndCleanup();
          }
        },
        { releaseAfterBuild: true },
      );
    },
  );

  it(
    "cancels runs when an approval is approved but missing a resume token over WebSocket",
    { timeout: 180_000 },
    async () => {
      await withGatewayBuild(
        async () => {
          const gateway = await startGatewayFixture({
            tempPrefix: "tyrum-gateway-ws-approval-missing-token-",
          });
          try {
            const db = openTestDatabase(gateway.dbPath);
            try {
              seedPausedApprovalRun(db, missingResumeTokenApprovalFixture);

              const ws = new WebSocket(
                `ws://127.0.0.1:${gateway.port}/ws`,
                authProtocols(gateway.tenantAdminToken),
              );
              try {
                await waitForOpen(ws);
                await completeHandshake(ws, {
                  requestIdPrefix: "r",
                  role: "client",
                  capabilities: [],
                });

                ws.send(
                  JSON.stringify({
                    request_id: `approval-${missingResumeTokenApprovalFixture.approvalId}`,
                    type: "approval.resolve",
                    payload: {
                      approval_id: missingResumeTokenApprovalFixture.approvalId,
                      decision: "approved",
                      reason: "approved in ws test (missing resume token)",
                    },
                  }),
                );

                const status = await waitForExecutionRunStatus(
                  db,
                  missingResumeTokenApprovalFixture.runId,
                  "cancelled",
                );
                expect(status, gateway.output()).toBe("cancelled");
              } finally {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                  ws.close();
                }
              }
            } finally {
              db.close();
            }
          } finally {
            await gateway.stopAndCleanup();
          }
        },
        { releaseAfterBuild: true },
      );
    },
  );

  // Windows runners do not reliably deliver a catchable SIGTERM/SIGINT to a Node child
  // process when its stdio is piped, so we can't assert graceful shutdown behavior there.
  const itShutdown = process.platform === "win32" ? it.skip : it;

  itShutdown(
    "processes gateway.shutdown hooks before stopping the worker loop",
    { timeout: 180_000 },
    async () => {
      await withGatewayBuild(
        async () => {
          const gateway = await startGatewayFixture({
            tempPrefix: "tyrum-gateway-shutdown-hooks-",
            configureHome: ({ dbPath }) => {
              const db = openTestDatabase(dbPath);
              try {
                seedLifecycleHooksConfig(db, [shutdownHookDefinition(shutdownHookKey)]);
              } finally {
                db.close();
              }
            },
          });
          try {
            await gateway.stop(20_000);

            const db = openTestDatabase(gateway.dbPath);
            try {
              const row = readLatestHookRunWithPause(db, shutdownHookConversationKey);
              expect(row, `gateway.shutdown hook run missing.\n${gateway.output()}`).toBeTruthy();
              if (!row) return;

              expect(row.status, gateway.output()).toBe("paused");
              expect(row.pausedReason, gateway.output()).toBe("policy");

              const trigger = JSON.parse(row.triggerJson) as {
                kind?: string;
                metadata?: Record<string, unknown>;
              };
              expect(trigger.kind, gateway.output()).toBe("hook");
              expect(trigger.metadata?.["hook_event"], gateway.output()).toBe("gateway.shutdown");
              expect(trigger.metadata?.["hook_key"], gateway.output()).toBe(shutdownHookKey);
            } finally {
              db.close();
            }
          } finally {
            gateway.cleanup();
          }
        },
        { releaseAfterBuild: true },
      );
    },
  );

  itShutdown(
    "does not miss gateway.shutdown hooks when the worker is busy",
    { timeout: 180_000 },
    async () => {
      await withGatewayBuild(
        async () => {
          const gateway = await startGatewayFixture({
            tempPrefix: "tyrum-gateway-shutdown-hooks-busy-",
            configureHome: ({ dbPath }) => {
              const db = openTestDatabase(dbPath);
              try {
                seedLifecycleHooksConfig(
                  db,
                  busyShutdownHookDefinitions(
                    process.execPath,
                    busyStartHookKey,
                    busyShutdownHookKey,
                  ),
                );
                seedDeploymentPolicyBundle(db, busyShutdownPolicyBundle);
              } finally {
                db.close();
              }
            },
          });
          try {
            const runningDb = openTestDatabase(gateway.dbPath);
            try {
              await waitForExecutionRunKeyStatus(
                runningDb,
                busyStartHookConversationKey,
                "running",
                gateway.output,
              );
            } finally {
              runningDb.close();
            }

            await gateway.stop(20_000);

            const db = openTestDatabase(gateway.dbPath);
            try {
              const row = readLatestHookRun(db, busyShutdownHookConversationKey);
              expect(row, `gateway.shutdown hook run missing.\n${gateway.output()}`).toBeTruthy();
              if (!row) return;

              expect(row.status, gateway.output()).not.toBe("queued");

              const trigger = JSON.parse(row.triggerJson) as {
                kind?: string;
                metadata?: Record<string, unknown>;
              };
              expect(trigger.kind, gateway.output()).toBe("hook");
              expect(trigger.metadata?.["hook_event"], gateway.output()).toBe("gateway.shutdown");
              expect(trigger.metadata?.["hook_key"], gateway.output()).toBe(busyShutdownHookKey);
            } finally {
              db.close();
            }
          } finally {
            gateway.cleanup();
          }
        },
        { releaseAfterBuild: true },
      );
    },
  );
});
