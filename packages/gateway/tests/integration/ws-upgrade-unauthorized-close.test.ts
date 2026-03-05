import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import type { AuthAudit } from "../../src/modules/auth/audit.js";
import type { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function waitForClose(ws: WebSocket, timeoutMs = 1_000): Promise<{ code: number; reason: Buffer }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for WebSocket close")),
      timeoutMs,
    );

    const onClose = (code: number, reason: Buffer) => {
      clearTimeout(timer);
      resolve({ code, reason });
    };

    const onError = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };

    ws.once("close", onClose);
    ws.once("error", onError);
  });
}

async function startWsServer(params: {
  authAudit: AuthAudit;
  authTokens: AuthTokenService;
  nodePairingDal?: NodePairingDal;
}): Promise<{ server: Server; port: number; stopHeartbeat: () => void }> {
  const connectionManager = new ConnectionManager();
  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    authTokens: params.authTokens,
    nodePairingDal: params.nodePairingDal,
    protocolDeps: {
      connectionManager,
      authAudit: params.authAudit,
    },
  });

  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      handleUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });

  return { server, port, stopHeartbeat };
}

describe("WS upgrade auth failure handling", () => {
  let server: Server | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let db: SqliteDb | undefined;

  afterEach(async () => {
    stopHeartbeat?.();
    stopHeartbeat = undefined;

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    await db?.close();
    db = undefined;
  });

  it("closes unauthenticated sockets even when auth audit throws", async () => {
    db = openTestSqliteDb();
    const authTokens = new AuthTokenService(db);

    const authAudit = {
      recordAuthFailed: async () => {
        throw new Error("boom");
      },
    } as unknown as AuthAudit;

    const started = await startWsServer({ authAudit, authTokens });
    server = started.server;
    stopHeartbeat = started.stopHeartbeat;

    const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1"]);
    const close = await waitForClose(ws);
    expect(close.code).toBe(4001);
  });

  it("closes unauthenticated sockets when resolveAuth rejects and audit throws", async () => {
    db = openTestSqliteDb();
    const authTokens = new AuthTokenService(db);

    const authAudit = {
      recordAuthFailed: async () => {
        throw new Error("boom");
      },
    } as unknown as AuthAudit;

    const nodePairingDal = {
      getNodeIdForScopedToken: () => {
        throw new Error("boom");
      },
    } as unknown as NodePairingDal;

    const started = await startWsServer({ authAudit, authTokens, nodePairingDal });
    server = started.server;
    stopHeartbeat = started.stopHeartbeat;

    const token = "bad";
    const authProtocol = `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`;
    const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1", authProtocol]);
    const close = await waitForClose(ws);
    expect(close.code).toBe(4001);
  });
});
