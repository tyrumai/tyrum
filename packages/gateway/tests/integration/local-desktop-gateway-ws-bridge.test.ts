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

async function waitForUnexpectedResponse(
  socket: WebSocket,
): Promise<{ body: string; statusCode: number }> {
  return await new Promise<{ body: string; statusCode: number }>((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
    };
    const onOpen = () => {
      cleanup();
      reject(new Error("expected websocket upgrade to be rejected"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onUnexpectedResponse = (
      _request: unknown,
      response: NodeJS.ReadableStream & { statusCode?: number },
    ) => {
      let body = "";
      response.setEncoding?.("utf8");
      response.on("data", (chunk: string | Buffer) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        cleanup();
        resolve({ body, statusCode: response.statusCode ?? 0 });
      });
      response.on("error", (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      response.resume?.();
    };

    socket.on("open", onOpen);
    socket.on("error", onError);
    socket.on("unexpected-response", onUnexpectedResponse);
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

  function localClientUrl(pathname?: string): URL {
    const advertisedUrl = new URL(bridge.gatewayWsUrl);
    const localUrl = new URL(advertisedUrl.toString());
    localUrl.protocol = "http:";
    localUrl.hostname = "127.0.0.1";
    if (pathname) {
      localUrl.pathname = pathname;
      localUrl.search = "";
    }
    return localUrl;
  }

  it("proxies websocket frames to the loopback gateway", async () => {
    const clientUrl = localClientUrl();
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

  it("rejects websocket upgrades that do not use the advertised bridge path", async () => {
    const clientUrl = localClientUrl("/ws");
    clientUrl.protocol = "ws:";

    const response = await waitForUnexpectedResponse(new WebSocket(clientUrl));

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("desktop gateway bridge path not found");
  });
});
