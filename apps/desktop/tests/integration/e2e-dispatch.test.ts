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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { getRequestListener } from "@hono/node-server";
import { createContainer } from "../../../../packages/gateway/src/container.js";
import { createApp } from "../../../../packages/gateway/src/app.js";
import { createWsHandler } from "../../../../packages/gateway/src/routes/ws.js";
import { ConnectionManager } from "../../../../packages/gateway/src/ws/connection-manager.js";
import { TokenStore } from "../../../../packages/gateway/src/modules/auth/token-store.js";
import { dispatchTask } from "../../../../packages/gateway/src/ws/protocol.js";
import type { ProtocolDeps } from "../../../../packages/gateway/src/ws/protocol.js";
import { TyrumClient, autoExecute } from "../../../../packages/client/src/index.js";
import { DesktopProvider } from "../../src/main/providers/desktop-provider.js";
import { CliProvider } from "../../src/main/providers/cli-provider.js";
import { resolvePermissions } from "../../src/main/config/permissions.js";
import { MockDesktopBackend } from "../../src/main/providers/backends/desktop-backend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../../../packages/gateway/migrations");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCapabilities(
  connectionManager: ConnectionManager,
  capabilities: ReadonlyArray<"desktop" | "cli" | "playwright" | "http" | "android">,
  timeoutMs = 2_000,
): Promise<void> {
  const required = [...new Set(capabilities)];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const stats = connectionManager.getStats();
    const ready = required.every((capability) => (stats.capabilityCounts[capability] ?? 0) > 0);
    if (ready) {
      return;
    }
    await delay(25);
  }

  const stats = connectionManager.getStats();
  throw new Error(
    `timed out waiting for capabilities ${required.join(", ")}; stats=${JSON.stringify(stats)}`,
  );
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
async function startServer(): Promise<{
  server: Server;
  port: number;
  adminToken: string;
  tokenHome: string;
  connectionManager: ConnectionManager;
  stopHeartbeat: () => void;
  taskResults: TaskResultEntry[];
}> {
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

  const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-e2e-dispatch-"));
  const tokenStore = new TokenStore(tokenHome);
  const adminToken = await tokenStore.initialize();

  const app = createApp(container, { connectionManager });
  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
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

/** Connect a TyrumClient and wait for the "connected" event. */
async function connectClient(
  port: number,
  token: string,
  capabilities: Array<"desktop" | "cli" | "playwright" | "http" | "android">,
  connectionManager: ConnectionManager,
): Promise<TyrumClient> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;

  const client = new TyrumClient({
    url: `ws://127.0.0.1:${port}/ws`,
    token,
    capabilities,
    reconnect: false,
    useDeviceProof: true,
    protocolRev: 2,
    device: {
      publicKey: publicKeyDer.toString("base64url"),
      privateKey: privateKeyDer.toString("base64url"),
    },
  });

  const connectedP = new Promise<void>((resolve) => {
    client.on("connected", () => resolve());
  });

  client.connect();
  await connectedP;
  await waitForCapabilities(connectionManager, capabilities);

  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("e2e: gateway dispatches task to desktop node", () => {
  let httpServer: Server | undefined;
  let client: TyrumClient | undefined;
  let tokenHome: string | undefined;
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
    if (tokenHome) {
      await rm(tokenHome, { recursive: true, force: true });
      tokenHome = undefined;
    }
    await delay(50);
  });

  it("dispatches Desktop.screenshot to connected desktop node and receives result", async () => {
    const srv = await startServer();
    httpServer = srv.server;
    tokenHome = srv.tokenHome;
    stopHeartbeat = srv.stopHeartbeat;

    // Connect client with desktop + cli capabilities
    const permissions = resolvePermissions("poweruser", {});
    client = await connectClient(
      srv.port,
      srv.adminToken,
      ["desktop", "cli"],
      srv.connectionManager,
    );
    expect(client.connected).toBe(true);

    const desktopProvider = new DesktopProvider(
      new MockDesktopBackend(),
      permissions,
      async () => true,
    );
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
    const taskId = await dispatchTask(
      {
        type: "Desktop",
        args: { op: "screenshot", display: "primary", format: "png" },
      },
      { runId: randomUUID(), stepId: randomUUID(), attemptId: randomUUID() },
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
    const srv = await startServer();
    httpServer = srv.server;
    tokenHome = srv.tokenHome;
    stopHeartbeat = srv.stopHeartbeat;

    const permissions = resolvePermissions("poweruser", {});
    client = await connectClient(srv.port, srv.adminToken, ["desktop"], srv.connectionManager);

    const desktopProvider = new DesktopProvider(
      new MockDesktopBackend(),
      permissions,
      async () => true,
    );
    autoExecute(client, [desktopProvider]);

    const taskId = await dispatchTask(
      {
        type: "Desktop",
        args: { op: "mouse", action: "click", x: 100, y: 200 },
      },
      { runId: randomUUID(), stepId: randomUUID(), attemptId: randomUUID() },
      { connectionManager: srv.connectionManager },
    );

    await delay(300);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(true);
  });

  it("rejects forbidden CLI command with error", async () => {
    const srv = await startServer();
    httpServer = srv.server;
    tokenHome = srv.tokenHome;
    stopHeartbeat = srv.stopHeartbeat;

    client = await connectClient(srv.port, srv.adminToken, ["cli"], srv.connectionManager);

    // Only "echo" is allowed
    const cliProvider = new CliProvider(["echo"], ["/tmp"]);
    autoExecute(client, [cliProvider]);

    const taskId = await dispatchTask(
      {
        type: "CLI",
        args: { cmd: "rm", args: ["-rf", "/"] },
      },
      { runId: randomUUID(), stepId: randomUUID(), attemptId: randomUUID() },
      { connectionManager: srv.connectionManager },
    );

    await delay(300);

    expect(srv.taskResults).toHaveLength(1);
    expect(srv.taskResults[0]!.taskId).toBe(taskId);
    expect(srv.taskResults[0]!.success).toBe(false);
    expect(srv.taskResults[0]!.error).toContain("not in the allowlist");
  });

  it("executes allowed CLI command successfully", async () => {
    const srv = await startServer();
    httpServer = srv.server;
    tokenHome = srv.tokenHome;
    stopHeartbeat = srv.stopHeartbeat;

    client = await connectClient(srv.port, srv.adminToken, ["cli"], srv.connectionManager);

    const cliProvider = new CliProvider(["echo"], ["/tmp"]);
    autoExecute(client, [cliProvider]);

    const taskId = await dispatchTask(
      {
        type: "CLI",
        args: { cmd: "echo", args: ["hello", "world"] },
      },
      { runId: randomUUID(), stepId: randomUUID(), attemptId: randomUUID() },
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
