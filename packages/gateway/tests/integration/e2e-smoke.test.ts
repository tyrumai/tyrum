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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { createTestApp, minimalPlanRequest } from "./helpers.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import type { SqlDb } from "../../src/statestore/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start a real HTTP server + WebSocket on a random port. */
async function startServer(
  app: Hono,
  db: SqlDb,
): Promise<{
  server: Server;
  port: number;
  adminToken: string;
  tokenHome: string;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
  taskResults: Array<{
    taskId: string;
    success: boolean;
    evidence: unknown;
    error: string | undefined;
  }>;
}> {
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

  // Use a real token store to enforce WS authentication.
  const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-e2e-smoke-"));
  const tokenStore = new TokenStore(tokenHome);
  const adminToken = await tokenStore.initialize();

  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
    db,
  });

  const requestListener = getRequestListener(app.fetch);
  const server = createServer(requestListener);

  server.on("upgrade", (req, socket, head) => {
    handleUpgrade(req, socket, head);
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });

  return {
    server,
    port,
    adminToken,
    tokenHome,
    connectionManager,
    stopHeartbeat,
    taskResults,
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("E2E smoke test", () => {
  let httpServer: Server | undefined;
  let client: TyrumClient | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let tokenHome: string | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
    if (tokenHome) {
      await rm(tokenHome, { recursive: true, force: true });
      tokenHome = undefined;
    }
  });

  it("full plan → dispatch → result → healthz flow", async () => {
    const { app, container } = await createTestApp();
    const srv = await startServer(app, container.db);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;
    tokenHome = srv.tokenHome;

    const baseUrl = `http://127.0.0.1:${srv.port}`;

    // --- 1. Connect a TyrumClient ---
    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: srv.adminToken,
      capabilities: ["playwright", "http"],
      reconnect: false,
      tyrumHome: srv.tokenHome,
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
    const taskDispatchP = new Promise<{
      task_id: string;
      run_id: string;
      step_id: string;
      attempt_id: string;
    }>(
      (resolve) => {
        client!.on("task_execute", (msg) => {
          resolve({
            task_id: msg.request_id,
            run_id: msg.payload.run_id,
            step_id: msg.payload.step_id,
            attempt_id: msg.payload.attempt_id,
          });
        });
      },
    );

    const ids = {
      runId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
    };

    const taskId = await dispatchTask(
      { type: "Http", args: { url: "https://example.com" } },
      ids,
      { connectionManager: srv.connectionManager },
    );

    // --- 5. Client receives task_dispatch ---
    const dispatch = await taskDispatchP;
    expect(dispatch.task_id).toBe(taskId);
    expect(dispatch.run_id).toBe(ids.runId);
    expect(dispatch.step_id).toBe(ids.stepId);
    expect(dispatch.attempt_id).toBe(ids.attemptId);

    // --- 6. Client sends task_result ---
    client.respondTaskExecute(taskId, true, undefined, { statusCode: 200 });

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
