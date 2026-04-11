import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Logger } from "../observability/logger.js";

function upgradeFailureResponse(status: number, message: string): Buffer {
  return Buffer.from(
    `HTTP/1.1 ${status} ${status === 404 ? "Not Found" : "Bad Gateway"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${String(Buffer.byteLength(message))}\r\n\r\n` +
      message,
    "utf8",
  );
}

function closeSocketWithResponse(socket: Duplex, status: number, message: string): void {
  socket.write(upgradeFailureResponse(status, message));
  socket.destroy();
}

function toCloseReason(reason: Buffer): string {
  const text = reason.toString("utf8").trim();
  return text.length > 0 ? text : "desktop gateway bridge closed";
}

function isForwardableWebSocketCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

function forwardWebSocketClose(input: { peer: WebSocket; code: number; reason: Buffer }): void {
  if (input.peer.readyState === WebSocket.OPEN) {
    if (isForwardableWebSocketCloseCode(input.code)) {
      input.peer.close(input.code, toCloseReason(input.reason));
      return;
    }
    input.peer.terminate();
    return;
  }
  if (input.peer.readyState === WebSocket.CONNECTING) {
    input.peer.terminate();
  }
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

export class LocalDesktopGatewayWsBridge {
  private server?: Server;
  private wss?: WebSocketServer;
  private listenPort?: number;
  private bridgePath?: string;

  constructor(
    private readonly options: {
      upstreamPort: number;
      logger?: Logger;
    },
  ) {}

  get gatewayWsUrl(): string {
    if (!this.listenPort || !this.bridgePath) {
      throw new Error("local desktop gateway bridge has not started");
    }
    return `ws://host.containers.internal:${String(this.listenPort)}${this.bridgePath}`;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("desktop gateway bridge only proxies websocket upgrades");
    });
    const wss = new WebSocketServer({ noServer: true });
    const bridgePath = `/desktop-gateway-bridge/${crypto.randomUUID()}/ws`;

    wss.on("connection", (client, req) => {
      const requestUrl = new URL(req.url ?? "/ws", "http://localhost");
      const requestedProtocols = req.headers["sec-websocket-protocol"];
      const protocols =
        typeof requestedProtocols === "string"
          ? requestedProtocols
              .split(",")
              .map((protocol) => protocol.trim())
              .filter(Boolean)
          : undefined;
      const upstreamUrl = new URL(`ws://127.0.0.1:${String(this.options.upstreamPort)}/ws`);
      upstreamUrl.search = requestUrl.search;
      const upstream = new WebSocket(upstreamUrl, protocols);
      const pendingMessages: Array<{ data: RawData; isBinary: boolean }> = [];

      upstream.on("open", () => {
        for (const message of pendingMessages) {
          upstream.send(message.data, { binary: message.isBinary });
        }
        pendingMessages.length = 0;
      });

      client.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
          return;
        }
        if (upstream.readyState === WebSocket.CONNECTING) {
          pendingMessages.push({ data, isBinary });
        }
      });

      upstream.on("message", (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });

      client.on("close", (code, reason) => {
        forwardWebSocketClose({ peer: upstream, code, reason });
      });
      upstream.on("close", (code, reason) => {
        forwardWebSocketClose({ peer: client, code, reason });
      });

      client.on("error", (error) => {
        this.options.logger?.error("desktop_environment.local_gateway_ws_bridge_client_error", {
          error,
        });
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.close(1011, "desktop gateway bridge client error");
        } else {
          upstream.terminate();
        }
      });
      upstream.on("error", (error) => {
        this.options.logger?.error("desktop_environment.local_gateway_ws_bridge_upstream_error", {
          error,
          upstream_url: upstreamUrl.toString(),
        });
        if (client.readyState === WebSocket.OPEN) {
          client.close(1011, "desktop gateway unavailable");
        } else {
          client.terminate();
        }
      });
    });

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (requestUrl.pathname !== bridgePath) {
        closeSocketWithResponse(socket, 404, "desktop gateway bridge path not found");
        return;
      }
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("desktop gateway bridge failed to resolve listen port");
    }

    this.server = server;
    this.wss = wss;
    this.listenPort = (address as AddressInfo).port;
    this.bridgePath = bridgePath;
    this.options.logger?.info("desktop_environment.local_gateway_ws_bridge_listen", {
      port: this.listenPort,
      upstream_port: this.options.upstreamPort,
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    const wss = this.wss;
    this.server = undefined;
    this.wss = undefined;
    this.listenPort = undefined;
    this.bridgePath = undefined;
    await Promise.allSettled([
      server ? closeServer(server) : Promise.resolve(),
      wss ? closeWebSocketServer(wss) : Promise.resolve(),
    ]);
  }
}
