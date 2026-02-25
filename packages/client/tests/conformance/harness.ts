/**
 * Shared test harness for SDK conformance tests.
 *
 * Starts a real gateway (Hono HTTP + WS upgrade) backed by in-memory SQLite
 * on a random port. Provides admin token, HTTP base URL, and WS URL for
 * client connections.
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { getRequestListener } from "@hono/node-server";

import { createTestApp } from "../../../gateway/tests/integration/helpers.js";
import { createWsHandler } from "../../../gateway/src/routes/ws.js";
import { ConnectionManager } from "../../../gateway/src/ws/connection-manager.js";
import { TokenStore } from "../../../gateway/src/modules/auth/token-store.js";
import { dispatchTask } from "../../../gateway/src/ws/protocol.js";
import type { ProtocolDeps } from "../../../gateway/src/ws/protocol.js";

export interface GatewayHarness {
  /** Random port the gateway listens on. */
  port: number;
  /** Admin token for authenticated requests. */
  adminToken: string;
  /** Full HTTP base URL, e.g. `http://127.0.0.1:<port>`. */
  baseUrl: string;
  /** Full WS URL, e.g. `ws://127.0.0.1:<port>/ws`. */
  wsUrl: string;
  /** Connection manager for observing connected clients. */
  connectionManager: ConnectionManager;
  /** Protocol deps wired to the gateway. */
  protocolDeps: ProtocolDeps;
  /** Dispatch a task to a connected, capable client. */
  dispatchTask: typeof dispatchTask;
  /** Tear down the gateway and clean up temp files. */
  stop: () => Promise<void>;
}

/**
 * Start a hermetic gateway instance for conformance testing.
 *
 * Creates a full Hono app with in-memory SQLite, auth middleware,
 * and WS upgrade support on a random port bound to 127.0.0.1.
 */
export async function startGateway(
  protocolDepsFactory?: (cm: ConnectionManager) => Partial<ProtocolDeps>,
): Promise<GatewayHarness> {
  const connectionManager = new ConnectionManager();
  const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-conformance-"));
  const tokenStore = new TokenStore(tokenHome);
  const adminToken = await tokenStore.initialize();

  const baseDeps: ProtocolDeps = { connectionManager };
  const extraDeps = protocolDepsFactory?.(connectionManager) ?? {};
  const protocolDeps: ProtocolDeps = { ...baseDeps, ...extraDeps };

  const { app } = await createTestApp({ tokenStore, isLocalOnly: false });

  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
  });

  const requestListener = getRequestListener(app.fetch);
  const server = createServer(requestListener);

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
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
    port,
    adminToken,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    connectionManager,
    protocolDeps,
    dispatchTask,
    stop: async () => {
      stopHeartbeat();
      await closeServer(server);
      await rm(tokenHome, { recursive: true, force: true });
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Generate a fresh Ed25519 key pair for vNext device handshake.
 * Returns base64url-encoded DER keys suitable for TyrumClient options.
 */
export function generateDeviceKeys(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return {
    publicKey: publicKeyDer.toString("base64url"),
    privateKey: privateKeyDer.toString("base64url"),
  };
}

/** Resolve a promise with a timeout. */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeoutP]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/** Small delay to let async frames flush. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
