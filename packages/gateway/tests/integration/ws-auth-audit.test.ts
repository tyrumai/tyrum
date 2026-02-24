import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { AuthAudit, GATEWAY_AUTH_AUDIT_PLAN_ID } from "../../src/modules/auth/audit.js";
import { AUTH_COOKIE_NAME } from "../../src/modules/auth/http.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { EventLog } from "../../src/modules/planner/event-log.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: Buffer }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason }));
  });
}

async function startWsServer(params: {
  authAudit: AuthAudit;
  tokenStore: TokenStore;
}): Promise<{ server: Server; port: number; stopHeartbeat: () => void }> {
  const connectionManager = new ConnectionManager();
  const { handleUpgrade, stopHeartbeat } = createWsHandler({
    connectionManager,
    tokenStore: params.tokenStore,
    protocolDeps: {
      connectionManager,
      authAudit: params.authAudit,
    },
  });

  const server = createServer();
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

  return { server, port, stopHeartbeat };
}

describe("WS auth audit events", () => {
  let server: Server | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let tokenHome: string | undefined;
  let db: SqliteDb | undefined;

  afterEach(async () => {
    stopHeartbeat?.();
    stopHeartbeat = undefined;

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    if (tokenHome) {
      await rm(tokenHome, { recursive: true, force: true });
      tokenHome = undefined;
    }

    await db?.close();
    db = undefined;
  });

  it("records auth.failed on missing WS upgrade token (rate-limited)", async () => {
    db = openTestSqliteDb();
    const eventLog = new EventLog(db);

    let nowMs = 0;
    const authAudit = new AuthAudit({
      eventLog,
      nowMs: () => nowMs,
      failedAuthWindowMs: 10_000,
    });

    tokenHome = await mkdtemp(join(tmpdir(), "tyrum-ws-auth-audit-token-"));
    const tokenStore = new TokenStore(tokenHome);
    await tokenStore.initialize();

    const started = await startWsServer({ authAudit, tokenStore });
    server = started.server;
    stopHeartbeat = started.stopHeartbeat;

    const ws1 = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1"]);
    const close1 = await waitForClose(ws1);
    expect(close1.code).toBe(4001);

    const rows1 = await db.all<{ action: string }>(
      "SELECT action FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [GATEWAY_AUTH_AUDIT_PLAN_ID],
    );
    expect(rows1).toHaveLength(1);
    const action1 = JSON.parse(rows1[0]!.action) as Record<string, unknown>;
    expect(action1["type"]).toBe("auth.failed");
    expect(action1["surface"]).toBe("ws.upgrade");
    expect(action1["reason"]).toBe("missing_token");
    expect(action1["token_transport"]).toBe("missing");

    const ws2 = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1"]);
    const close2 = await waitForClose(ws2);
    expect(close2.code).toBe(4001);

    const rows2 = await db.all<{ id: number }>(
      "SELECT id FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [GATEWAY_AUTH_AUDIT_PLAN_ID],
    );
    expect(rows2).toHaveLength(1);

    nowMs = 20_000;
    const ws3 = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1"]);
    const close3 = await waitForClose(ws3);
    expect(close3.code).toBe(4001);

    const rows3 = await db.all<{ id: number }>(
      "SELECT id FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [GATEWAY_AUTH_AUDIT_PLAN_ID],
    );
    expect(rows3).toHaveLength(2);
  });

  it("records token_transport cookie when an auth cookie is present but rejected cross-origin", async () => {
    db = openTestSqliteDb();
    const eventLog = new EventLog(db);

    const authAudit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
      failedAuthWindowMs: 10_000,
    });

    tokenHome = await mkdtemp(join(tmpdir(), "tyrum-ws-auth-audit-token-"));
    const tokenStore = new TokenStore(tokenHome);
    const adminToken = await tokenStore.initialize();

    const started = await startWsServer({ authAudit, tokenStore });
    server = started.server;
    stopHeartbeat = started.stopHeartbeat;

    const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, ["tyrum-v1"], {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(adminToken)}`,
        origin: "https://evil.example",
      },
    });
    const close = await waitForClose(ws);
    expect(close.code).toBe(4001);

    const rows = await db.all<{ action: string }>(
      "SELECT action FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [GATEWAY_AUTH_AUDIT_PLAN_ID],
    );
    expect(rows).toHaveLength(1);
    const action = JSON.parse(rows[0]!.action) as Record<string, unknown>;
    expect(action["type"]).toBe("auth.failed");
    expect(action["surface"]).toBe("ws.upgrade");
    expect(action["reason"]).toBe("missing_token");
    expect(action["token_transport"]).toBe("cookie");
  });
});
