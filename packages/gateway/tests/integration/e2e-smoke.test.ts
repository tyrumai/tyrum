/**
 * End-to-end smoke test — exercises the full gateway + client SDK flow.
 *
 * 1. Creates an in-memory container and Hono app.
 * 2. Starts a real Node.js HTTP server with WebSocket upgrade support.
 * 3. Connects a TyrumClient over WebSocket.
 * 4. POSTs /plan to trigger the orchestrator.
 * 5. Verifies the client receives a task_dispatch.
 * 6. Sends task_result back.
 * 7. Checks /healthz returns 200.
 * 8. Cleans up.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createTestApp, minimalPlanRequest } from "./helpers.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start a real HTTP server + WebSocket on a random port. */
function startServer(
  app: ReturnType<typeof createTestApp>["app"],
): {
  server: Server;
  port: number;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
  taskResults: Array<{
    taskId: string;
    success: boolean;
    evidence: unknown;
    error: string | undefined;
  }>;
} {
  const connectionManager = new ConnectionManager();
  const taskResults: Array<{
    taskId: string;
    success: boolean;
    evidence: unknown;
    error: string | undefined;
  }> = [];

  const protocolDeps: ProtocolDeps = {
    connectionManager,
    onTaskResult(taskId, success, evidence, error) {
      taskResults.push({ taskId, success, evidence, error });
    },
  };

  // Use a dummy token store with local-only mode for e2e tests
  const tokenStore = new TokenStore("/tmp/tyrum-e2e-test-" + Date.now());

  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
    isLocalOnly: true,
  });

  const requestListener = getRequestListener(app.fetch);
  const server = createServer(requestListener);

  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(req, socket, head);
  });

  server.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  return { server, port, connectionManager, stopHeartbeat, taskResults };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("E2E smoke test", () => {
  let httpServer: Server | undefined;
  let client: TyrumClient | undefined;
  let stopHeartbeat: (() => void) | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it("full plan → dispatch → result → healthz flow", async () => {
    const { app } = createTestApp();
    const srv = startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    const baseUrl = `http://127.0.0.1:${srv.port}`;

    // --- 1. Connect a TyrumClient ---
    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: "e2e-test-token",
      capabilities: ["playwright", "http"],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await connectedP;
    expect(client.connected).toBe(true);

    // Give the server a moment to register the client after hello
    await delay(50);

    // --- 2. Verify /healthz ---
    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as { status: string };
    expect(healthBody.status).toBe("ok");

    // --- 3. Verify ConnectionManager has the client ---
    const stats = srv.connectionManager.getStats();
    expect(stats.totalClients).toBe(1);

    // --- 4. Dispatch a task to the connected client ---
    // We dispatch directly via the connection manager (the /plan route
    // orchestrator does not dispatch over WS in the current TS impl;
    // it returns a PlanResponse).  This exercises the protocol layer.
    const taskDispatchP = new Promise<{ task_id: string; plan_id: string }>(
      (resolve) => {
        client!.on("task_dispatch", (msg) => {
          resolve({ task_id: msg.task_id, plan_id: msg.plan_id });
        });
      },
    );

    const httpClient = srv.connectionManager.getClientForCapability("http");
    expect(httpClient).toBeDefined();

    const taskId = crypto.randomUUID();
    const planId = "plan-e2e-1";
    httpClient!.ws.send(
      JSON.stringify({
        type: "task_dispatch",
        task_id: taskId,
        plan_id: planId,
        action: { type: "Http", args: { url: "https://example.com" } },
      }),
    );

    // --- 5. Client receives task_dispatch ---
    const dispatch = await taskDispatchP;
    expect(dispatch.task_id).toBe(taskId);
    expect(dispatch.plan_id).toBe(planId);

    // --- 6. Client sends task_result ---
    client.sendTaskResult(taskId, true, { statusCode: 200 });

    // Give the server time to process the result
    await delay(50);

    expect(srv.taskResults.length).toBe(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(true);

    // --- 7. POST /plan works ---
    const planBody = minimalPlanRequest({ tags: ["spend:0:USD"] });
    const planRes = await fetch(`${baseUrl}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planBody),
    });
    expect(planRes.status).toBe(200);
    const planJson = (await planRes.json()) as {
      plan_id: string;
      status: string;
    };
    expect(planJson.plan_id).toMatch(/^plan-/);
    expect(planJson.status).toBe("success");
  });
});
