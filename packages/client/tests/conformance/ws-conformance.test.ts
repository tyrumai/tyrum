/**
 * WebSocket SDK conformance tests.
 *
 * Validates `TyrumClient` behavior against a real gateway instance:
 * - Subprotocol auth (bearer via subprotocol header)
 * - connect.init / connect.proof handshake
 * - Representative WS request helpers (ping, task.execute round-trip)
 * - Representative events are received and parsed
 *
 * All tests are hermetic: random ports, in-memory SQLite, temp token dirs.
 */

import { describe, it, expect, afterEach } from "vitest";
import { WsTaskExecuteRequest } from "@tyrum/schemas";
import { TyrumClient } from "../../src/ws-client.js";
import {
  startGateway,
  generateDeviceKeys,
  withTimeout,
  delay,
  type GatewayHarness,
} from "./harness.js";
import { CONFORMANCE_TIMEOUT_MS, createConnectedClient, waitForEvent } from "./ws-test-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT = CONFORMANCE_TIMEOUT_MS;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WS SDK conformance (client <-> gateway)", () => {
  let gw: GatewayHarness | undefined;
  let client: TyrumClient | undefined;
  const extraClients: TyrumClient[] = [];

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    for (const c of extraClients) c.disconnect();
    extraClients.length = 0;
    if (gw) {
      await gw.stop();
      gw = undefined;
    }
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it("authenticates via subprotocol and completes vNext handshake", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    const { clientId } = await withTimeout(result.connectedP, TIMEOUT, "connected");
    expect(clientId).toBeTruthy();
    expect(typeof clientId).toBe("string");
  });

  it("rejects connection with invalid token", async () => {
    gw = await startGateway();
    const device = generateDeviceKeys();
    client = new TyrumClient({
      url: gw.wsUrl,
      token: "invalid-token-that-should-fail",
      capabilities: ["http"],
      reconnect: false,
      role: "client",
      protocolRev: 2,
      device,
    });

    const disconnectedP = waitForEvent<{ code: number; reason: string }>(client, "disconnected");
    client.connect();

    const { code } = await withTimeout(disconnectedP, TIMEOUT, "disconnected");
    // 4001 = auth failure close code used by the gateway
    expect(code).toBeGreaterThanOrEqual(4000);
  });

  // -------------------------------------------------------------------------
  // Handshake schema conformance
  // -------------------------------------------------------------------------

  it("vNext handshake registers client with correct protocol properties", async () => {
    gw = await startGateway((cm) => ({ connectionManager: cm }));

    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    // Verify the client registered in ConnectionManager with expected properties
    const clients = [...gw.connectionManager.allClients()];
    expect(clients.length).toBe(1);
    const registered = clients[0];
    expect(registered.protocol_rev).toBe(2);
    expect(registered.capabilities).toContain("http");
    expect(registered.role).toBe("client");
    expect(registered.device_id).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Ping round-trip
  // -------------------------------------------------------------------------

  it("client ping() round-trips through the gateway", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    // ping() sends a ping request and awaits the pong — resolves without error
    await withTimeout(client.ping(), TIMEOUT, "ping");
  });

  // -------------------------------------------------------------------------
  // Task dispatch + response round-trip
  // -------------------------------------------------------------------------

  it("gateway dispatches task.execute, client responds, gateway receives result", async () => {
    let resolveTaskResult:
      | ((v: {
          taskId: string;
          success: boolean;
          result: unknown;
          evidence: unknown;
          error?: string;
        }) => void)
      | undefined;
    const taskResultP = new Promise<{
      taskId: string;
      success: boolean;
      result: unknown;
      evidence: unknown;
      error?: string;
    }>((resolve) => {
      resolveTaskResult = resolve;
    });

    gw = await startGateway((cm) => ({
      connectionManager: cm,
      onTaskResult(taskId, success, result, evidence, error) {
        resolveTaskResult?.({ taskId, success, result, evidence, error });
      },
    }));

    const result = createConnectedClient(gw, { capabilities: ["http"] });
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const taskExecuteP = waitForEvent<WsTaskExecuteRequest>(client, "task_execute");

    // Gateway dispatches a task to the connected client
    const taskId = await gw.dispatchTask(
      { type: "Http", args: { url: "https://example.com" } },
      {
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      gw.protocolDeps,
    );

    const taskReq = await withTimeout(taskExecuteP, TIMEOUT, "task_execute");
    expect(taskReq.request_id).toBe(taskId);

    // Validate the received request against the schema
    WsTaskExecuteRequest.parse(taskReq);

    // Client responds with task result
    client.respondTaskExecute(taskId, true, undefined, { statusCode: 200 });

    const taskResult = await withTimeout(taskResultP, TIMEOUT, "onTaskResult");
    expect(taskResult.taskId).toBe(taskId);
    expect(taskResult.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multiple capabilities registration
  // -------------------------------------------------------------------------

  it("registers multiple capabilities and gateway can observe them", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw, { capabilities: ["http", "playwright"] });
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const clients = [...gw.connectionManager.allClients()];
    expect(clients.length).toBe(1);
    const registered = clients[0];
    expect(registered.capabilities).toContain("http");
    expect(registered.capabilities).toContain("playwright");
  });

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  it("client disconnect is clean and removes from connection manager", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    expect([...gw.connectionManager.allClients()].length).toBe(1);

    const disconnectedP = waitForEvent<{ code: number }>(client, "disconnected");
    client.disconnect();
    await withTimeout(disconnectedP, TIMEOUT, "disconnected");

    // Allow the gateway to process the close
    await delay(50);
    expect([...gw.connectionManager.allClients()].length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Concurrent clients
  // -------------------------------------------------------------------------

  it("supports multiple concurrent client connections", async () => {
    gw = await startGateway();

    const c1 = createConnectedClient(gw, { capabilities: ["http"] });
    const c2 = createConnectedClient(gw, { capabilities: ["playwright"] });
    extraClients.push(c1.client, c2.client);

    await withTimeout(c1.connectedP, TIMEOUT, "client1 connected");
    await withTimeout(c2.connectedP, TIMEOUT, "client2 connected");

    const clients = [...gw.connectionManager.allClients()];
    expect(clients.length).toBe(2);

    const caps = clients.flatMap((c) => c.capabilities);
    expect(caps).toContain("http");
    expect(caps).toContain("playwright");
  });
});
