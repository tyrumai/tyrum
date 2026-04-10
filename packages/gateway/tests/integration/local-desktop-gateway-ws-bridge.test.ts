import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { LocalDesktopGatewayWsBridge } from "../../src/modules/desktop-environments/local-gateway-ws-bridge.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not expose an address");
  }
  return (address as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function nextTextMessage(socket: WebSocket): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    socket.once("message", (data, isBinary) => {
      if (isBinary) {
        reject(new Error("expected text websocket message"));
        return;
      }
      resolve(data.toString());
    });
    socket.once("error", reject);
  });
}

describe("LocalDesktopGatewayWsBridge", () => {
  let upstreamServer: Server;
  let upstreamWss: WebSocketServer;
  let upstreamPort: number;
  let bridge: LocalDesktopGatewayWsBridge;

  beforeEach(async () => {
    upstreamServer = createServer();
    upstreamWss = new WebSocketServer({ server: upstreamServer, path: "/ws" });
    upstreamWss.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => {
        socket.send(data, { binary: isBinary });
      });
    });
    upstreamPort = await listen(upstreamServer);
    bridge = new LocalDesktopGatewayWsBridge({ upstreamPort });
    await bridge.start();
  });

  afterEach(async () => {
    await Promise.allSettled([
      bridge.stop(),
      closeWebSocketServer(upstreamWss),
      closeServer(upstreamServer),
    ]);
  });

  function localClientUrl(pathname = "/ws"): URL {
    const advertisedUrl = new URL(bridge.gatewayWsUrl);
    return new URL(`${pathname}${advertisedUrl.search}`, `http://127.0.0.1:${advertisedUrl.port}`);
  }

  it("proxies websocket frames to the loopback gateway", async () => {
    const clientUrl = localClientUrl("/ws");
    clientUrl.protocol = "ws:";
    const client = new WebSocket(clientUrl);
    await waitForOpen(client);
    client.send("ping");
    await expect(nextTextMessage(client)).resolves.toBe("ping");
    client.close(1000, "done");
  });

  it("does not proxy plain HTTP requests", async () => {
    const requestUrl = localClientUrl("/healthz");

    const response = await fetch(requestUrl);

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("only proxies websocket upgrades");
  });
});
