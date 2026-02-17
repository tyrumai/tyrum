/**
 * Integration test: embedded gateway + desktop/cli node dispatch.
 *
 * Exercises the full round-trip:
 * 1. Start a real gateway (HTTP + WS) on a random port
 * 2. Connect a TyrumClient with desktop+cli capabilities and autoExecute
 * 3. Dispatch a Desktop action via the protocol layer
 * 4. Verify the task result arrives back at the gateway via onTaskResult
 * 5. Dispatch a forbidden CLI command and verify it is rejected
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { createContainer } from "../../../../packages/gateway/src/container.js";
import { createApp } from "../../../../packages/gateway/src/app.js";
import { createWsHandler } from "../../../../packages/gateway/src/routes/ws.js";
import { ConnectionManager } from "../../../../packages/gateway/src/ws/connection-manager.js";
import { dispatchTask } from "../../../../packages/gateway/src/ws/protocol.js";
import type { ProtocolDeps } from "../../../../packages/gateway/src/ws/protocol.js";
import { TyrumClient, autoExecute } from "../../../../packages/client/src/index.js";
import { DesktopProvider } from "../../src/main/providers/desktop-provider.js";
import { CliProvider } from "../../src/main/providers/cli-provider.js";
import { resolvePermissions } from "../../src/main/config/permissions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../../../packages/gateway/migrations");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TaskResultEntry {
  taskId: string;
  success: boolean;
  evidence: unknown;
  error: string | undefined;
}

/**
 * Start a real HTTP server + WebSocket on a random port.
 *
 * The `onTaskResult` callback in `protocolDeps` is wired to push into the
 * returned `taskResults` array, so any `task_result` messages received from
 * clients are captured for assertions.
 */
function startServer(): {
  server: Server;
  port: number;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
  taskResults: TaskResultEntry[];
} {
  const container = createContainer({
    dbPath: ":memory:",
    migrationsDir,
  });
  const connectionManager = new ConnectionManager();
  const taskResults: TaskResultEntry[] = [];

  const protocolDeps: ProtocolDeps = {
    connectionManager,
    onTaskResult(taskId, success, evidence, error) {
      taskResults.push({ taskId, success, evidence, error });
    },
  };

  const app = createApp(container, { connectionManager });
  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
  });

  const requestListener = getRequestListener(app.fetch);
  const server = createServer(requestListener);

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;

  return { server, port, connectionManager, stopHeartbeat, taskResults };
}

/** Connect a TyrumClient and wait for the "connected" event. */
async function connectClient(
  port: number,
  capabilities: Array<"desktop" | "cli" | "playwright" | "http" | "android">,
): Promise<TyrumClient> {
  const client = new TyrumClient({
    url: `ws://127.0.0.1:${port}/ws`,
    token: "test",
    capabilities,
    reconnect: false,
  });

  const connectedP = new Promise<void>((resolve) => {
    client.on("connected", () => resolve());
  });

  client.connect();
  await connectedP;

  // Allow server time to register the hello handshake
  await delay(100);

  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("e2e: gateway dispatches task to desktop node", () => {
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
    await delay(50);
  });

  it("dispatches Desktop.screenshot to connected desktop node and receives result", async () => {
    const srv = startServer();
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    // Connect client with desktop + cli capabilities
    const permissions = resolvePermissions("poweruser", {});
    client = await connectClient(srv.port, ["desktop", "cli"]);
    expect(client.connected).toBe(true);

    const desktopProvider = new DesktopProvider(permissions, async () => true);
    const cliProvider = new CliProvider(["echo"], ["/tmp"]);
    autoExecute(client, [desktopProvider, cliProvider]);

    // Verify connection was registered
    const stats = srv.connectionManager.getStats();
    expect(stats.totalClients).toBe(1);
    expect(stats.capabilityCounts["desktop"]).toBe(1);

    // Dispatch a Desktop.screenshot task.
    // dispatchTask sends the task_dispatch to the client over WS.
    // autoExecute handles it, runs the provider, sends task_result back.
    // The WS handler calls handleClientMessage which invokes onTaskResult
    // from the protocolDeps wired in startServer -- captured in srv.taskResults.
    const taskId = dispatchTask(
      {
        type: "Desktop",
        args: { op: "screenshot", display: "primary", format: "png" },
      },
      "plan-1",
      0,
      { connectionManager: srv.connectionManager },
    );

    // Wait for the round-trip
    await delay(300);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(true);
    expect(srv.taskResults[0]!.evidence).toBeDefined();
  });

  it("dispatches Desktop.mouse action through the full round-trip", async () => {
    const srv = startServer();
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    const permissions = resolvePermissions("poweruser", {});
    client = await connectClient(srv.port, ["desktop"]);

    const desktopProvider = new DesktopProvider(permissions, async () => true);
    autoExecute(client, [desktopProvider]);

    const taskId = dispatchTask(
      {
        type: "Desktop",
        args: { op: "mouse", action: "click", x: 100, y: 200 },
      },
      "plan-2",
      0,
      { connectionManager: srv.connectionManager },
    );

    await delay(300);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(true);
  });

  it("rejects forbidden CLI command with error", async () => {
    const srv = startServer();
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    client = await connectClient(srv.port, ["cli"]);

    // Only "echo" is allowed
    const cliProvider = new CliProvider(["echo"], ["/tmp"]);
    autoExecute(client, [cliProvider]);

    const taskId = dispatchTask(
      {
        type: "CLI",
        args: { cmd: "rm", args: ["-rf", "/"] },
      },
      "plan-3",
      0,
      { connectionManager: srv.connectionManager },
    );

    await delay(300);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(false);
    expect(srv.taskResults[0]!.error).toContain("not in the allowlist");
  });

  it("executes allowed CLI command successfully", async () => {
    const srv = startServer();
    httpServer = srv.server;
    stopHeartbeat = srv.stopHeartbeat;

    client = await connectClient(srv.port, ["cli"]);

    const cliProvider = new CliProvider(["echo"], ["/tmp"]);
    autoExecute(client, [cliProvider]);

    const taskId = dispatchTask(
      {
        type: "CLI",
        args: { cmd: "echo", args: ["hello", "world"] },
      },
      "plan-4",
      0,
      { connectionManager: srv.connectionManager },
    );

    await delay(500);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(true);

    const evidence = srv.taskResults[0]!.evidence as {
      exit_code: number;
      stdout: string;
    };
    expect(evidence.exit_code).toBe(0);
    expect(evidence.stdout).toContain("hello world");
  });
});
