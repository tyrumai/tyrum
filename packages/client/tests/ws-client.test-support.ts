import { expect, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import type { TyrumClient } from "../src/ws-client.js";

/** Start a `ws` server on a random port and return the URL + cleanup. */
export function createTestServer(): {
  wss: WebSocketServer;
  url: string;
  port: number;
  close: () => Promise<void>;
  waitForClient: () => Promise<WsWebSocket>;
  waitForProtocolHeader: () => Promise<string | string[] | undefined>;
} {
  const wss = new WebSocketServer({ port: 0 });
  const addr = wss.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const url = `ws://127.0.0.1:${port}`;

  const clientWaiters: Array<(ws: WsWebSocket) => void> = [];
  const pendingClients: WsWebSocket[] = [];
  const protocolWaiters: Array<(value: string | string[] | undefined) => void> = [];
  const pendingProtocols: Array<string | string[] | undefined> = [];

  wss.on("connection", (ws, req) => {
    const offeredProtocols = req.headers["sec-websocket-protocol"];
    const protocolWaiter = protocolWaiters.shift();
    if (protocolWaiter) {
      protocolWaiter(offeredProtocols);
    } else {
      pendingProtocols.push(offeredProtocols);
    }

    const waiter = clientWaiters.shift();
    if (waiter) {
      waiter(ws);
    } else {
      pendingClients.push(ws);
    }
  });

  function waitForClient(): Promise<WsWebSocket> {
    const pending = pendingClients.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise<WsWebSocket>((resolve) => {
      clientWaiters.push(resolve);
    });
  }

  function waitForProtocolHeader(): Promise<string | string[] | undefined> {
    const pending = pendingProtocols.shift();
    if (pending !== undefined) return Promise.resolve(pending);
    return new Promise<string | string[] | undefined>((resolve) => {
      protocolWaiters.push(resolve);
    });
  }

  async function close(): Promise<void> {
    return new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  return { wss, url, port, close, waitForClient, waitForProtocolHeader };
}

/** Wait for a JSON message from a ws-library WebSocket. */
export function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

export async function acceptConnect(
  ws: WsWebSocket,
  clientId = "client-1",
): Promise<{ request_id: string }> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  expect(typeof init["request_id"]).toBe("string");
  const initRequestId = String(init["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: initRequestId,
      type: "connect.init",
      ok: true,
      result: { connection_id: "conn-1", challenge: "nonce-1" },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  expect(typeof proof["request_id"]).toBe("string");
  const proofRequestId = String(proof["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: proofRequestId,
      type: "connect.proof",
      ok: true,
      result: { client_id: clientId, device_id: "device-1", role: "client" },
    }),
  );

  return { request_id: proofRequestId };
}

/** Small delay helper. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    delay(ms).then(() => {
      throw new Error(`${label} timeout after ${ms}ms`);
    }),
  ]);
}

export function waitForReconnectScheduled(
  client: TyrumClient,
): Promise<{ delayMs: number; nextRetryAtMs: number; attempt: number }> {
  return new Promise((resolve) => {
    const handler = (event: { delayMs: number; nextRetryAtMs: number; attempt: number }) => {
      client.off("reconnect_scheduled", handler);
      resolve(event);
    };
    client.on("reconnect_scheduled", handler);
  });
}

export function handleInboundFrame(client: TyrumClient, raw: string): void {
  (
    client as unknown as {
      handleMessage: (frame: string) => void;
    }
  ).handleMessage(raw);
}

export type TestServer = ReturnType<typeof createTestServer>;
