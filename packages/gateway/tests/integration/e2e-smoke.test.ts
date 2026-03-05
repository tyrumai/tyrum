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
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener as honoGetRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { createTestApp, minimalPlanRequest } from "./helpers.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { dispatchTask, type ProtocolDeps } from "../../src/ws/protocol.js";
import { TyrumClient } from "../../../client/src/ws-client.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { generateKeyPairSync } from "node:crypto";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { waitForCondition } from "../helpers/wait-for.js";
import { pathExists } from "../helpers/path-exists.js";

let getRequestListener: typeof honoGetRequestListener = honoGetRequestListener;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a real HTTP server + WebSocket on a random port. */
async function startServer(app: Hono): Promise<{
  server: Server;
  port: number;
  adminToken: string;
  tokenHome: string;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
  taskResults: Array<{
    taskId: string;
    success: boolean;
    result: unknown;
    evidence: unknown;
    error: string | undefined;
  }>;
}> {
  const connectionManager = new ConnectionManager();
  const taskResults: Array<{
    taskId: string;
    success: boolean;
    result: unknown;
    evidence: unknown;
    error: string | undefined;
  }> = [];

  const protocolDeps: ProtocolDeps = {
    connectionManager,
    onTaskResult(taskId, success, result, evidence, error) {
      taskResults.push({ taskId, success, result, evidence, error });
    },
  };

  // Use a real token store to enforce WS authentication.
  const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-e2e-test-"));
  let tokenStore: TokenStore;
  let adminToken: string;
  let stopHeartbeat: (() => void) | undefined;
  let server: Server | undefined;
  try {
    tokenStore = new TokenStore(tokenHome);
    adminToken = await tokenStore.initialize();

    const wsHandler = createWsHandler({
      connectionManager,
      protocolDeps,
      tokenStore,
    });
    stopHeartbeat = wsHandler.stopHeartbeat;

    const requestListener = getRequestListener(app.fetch);
    server = createServer(requestListener);

    server.on("upgrade", (req, socket, head) => {
      wsHandler.handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
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
  } catch (error) {
    stopHeartbeat?.();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve())).catch(() => undefined);
    }
    await rm(tokenHome, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
      const home = tokenHome;
      tokenHome = undefined;
      await rm(home, { recursive: true, force: true });
      expect(await pathExists(home)).toBe(false);
    }
  });

  it("removes tokenHome when server setup throws", async () => {
    const before = new Set(
      (await readdir(tmpdir())).filter((entry) => entry.startsWith("tyrum-e2e-test-")),
    );

    const originalGetRequestListener = getRequestListener;
    getRequestListener = () => {
      throw new Error("test setup failed");
    };
    try {
      const { app } = await createTestApp();
      await expect(startServer(app)).rejects.toThrow("test setup failed");
    } finally {
      getRequestListener = originalGetRequestListener;
    }

    const after = (await readdir(tmpdir())).filter((entry) => entry.startsWith("tyrum-e2e-test-"));
    const leaked = after.filter((entry) => !before.has(entry));

    await Promise.all(
      leaked.map((entry) => rm(join(tmpdir(), entry), { recursive: true, force: true })),
    );

    expect(leaked).toHaveLength(0);
  });

  it("full plan → dispatch → result → healthz flow", async () => {
    const { app } = await createTestApp();
    const srv = await startServer(app);
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;
    tokenHome = srv.tokenHome;

    const baseUrl = `http://127.0.0.1:${srv.port}`;

    // --- 1. Connect a TyrumClient ---
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

    client = new TyrumClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: srv.adminToken,
      capabilities: ["playwright", "http"],
      reconnect: false,
      role: "node",
      protocolRev: 2,
      device: {
        publicKey: publicKeyDer.toString("base64url"),
        privateKey: privateKeyDer.toString("base64url"),
      },
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    await connectedP;
    expect(client.connected).toBe(true);

    await waitForCondition(() => srv.connectionManager.getStats().totalClients === 1, {
      description: "ConnectionManager to register the connected client",
      debug: () => JSON.stringify(srv.connectionManager.getStats()),
    });

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
    const taskDispatchP = new Promise<{ task_id: string; run_id: string }>((resolve) => {
      client!.on("task_execute", (msg) => {
        resolve({ task_id: msg.request_id, run_id: msg.payload.run_id });
      });
    });

    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const taskId = await dispatchTask(
      { type: "Http", args: { url: "https://example.com" } },
      {
        runId,
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      {
        connectionManager: srv.connectionManager,
        nodePairingDal: {
          getByNodeId: async () =>
            ({
              status: "approved",
              capability_allowlist: [
                {
                  id: descriptorIdForClientCapability("http"),
                  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                },
              ],
            }) as never,
        } as never,
      },
    );

    // --- 5. Client receives task_dispatch ---
    const dispatch = await taskDispatchP;
    expect(dispatch.task_id).toBe(taskId);
    expect(dispatch.run_id).toBe(runId);

    // --- 6. Client sends task_result ---
    client.respondTaskExecute(taskId, true, undefined, { statusCode: 200 });

    await waitForCondition(() => srv.taskResults.some((res) => res.taskId === taskId), {
      description: "server to process task_result",
      debug: () =>
        JSON.stringify(
          srv.taskResults.map(({ taskId: taskId2, success, error }) => ({
            taskId: taskId2,
            success,
            error,
          })),
        ),
    });

    const taskResult = srv.taskResults.find((res) => res.taskId === taskId);
    expect(taskResult).toBeDefined();
    expect(taskResult!.success).toBe(true);

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
