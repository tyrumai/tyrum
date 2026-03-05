import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

async function startServer(server: Server): Promise<number> {
  return await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });
}

async function attemptUpgrade(port: number): Promise<{
  kind: "upgraded" | "rejected";
  statusCode: number;
  retryAfter?: string;
}> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/ws",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Protocol": "tyrum-v1",
        },
      },
      (res) => {
        const retryAfterHeader = res.headers["retry-after"];
        const retryAfter = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
        res.resume();
        resolve({
          kind: "rejected",
          statusCode: res.statusCode ?? 0,
          retryAfter: typeof retryAfter === "string" ? retryAfter : undefined,
        });
      },
    );

    req.once("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ kind: "upgraded", statusCode: res.statusCode ?? 0 });
    });

    req.once("error", (err) => reject(err));
    req.end();
  });
}

describe("WS upgrade rate limiting", () => {
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

  it("rejects the 11th upgrade attempt within a minute per IP", async () => {
    db = openTestSqliteDb();
    const authTokens = new AuthTokenService(db);

    const upgradeRateLimiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 10,
      cleanupIntervalMs: 0,
    });

    const connectionManager = new ConnectionManager();
    const handler = createWsHandler({
      connectionManager,
      protocolDeps: { connectionManager },
      authTokens,
      upgradeRateLimiter,
    });
    stopHeartbeat = handler.stopHeartbeat;

    server = createServer();
    server.on("upgrade", (req, socket, head) => {
      if (req.url?.startsWith("/ws")) {
        handler.handleUpgrade(req, socket, head);
        return;
      }
      socket.destroy();
    });

    const port = await startServer(server);

    for (let i = 0; i < 10; i += 1) {
      const result = await attemptUpgrade(port);
      expect(result).toEqual({ kind: "upgraded", statusCode: 101 });
    }

    const blocked = await attemptUpgrade(port);
    expect(blocked.kind).toBe("rejected");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.retryAfter).toBeTruthy();

    upgradeRateLimiter.stop();
  });
});
