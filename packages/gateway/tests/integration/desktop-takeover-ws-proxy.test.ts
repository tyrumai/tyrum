import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { createDesktopTakeoverWsProxy } from "../../src/modules/desktop-environments/takeover-proxy.js";
import { DesktopTakeoverSessionDal } from "../../src/modules/desktop-environments/takeover-session-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "./helpers.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function closeWebSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket) {
    return Promise.resolve();
  }
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

describe("desktop takeover websocket proxy", () => {
  let upstreamServer: Server | undefined;
  let proxyServer: Server | undefined;
  let upstreamWss: WebSocketServer | undefined;
  let client: WebSocket | undefined;
  let container: Awaited<ReturnType<typeof createTestContainer>> | undefined;

  afterEach(async () => {
    await closeWebSocket(client);
    client = undefined;

    upstreamWss?.clients.forEach((socket) => socket.terminate());
    upstreamWss?.close();
    upstreamWss = undefined;

    await closeServer(proxyServer);
    proxyServer = undefined;
    await closeServer(upstreamServer);
    upstreamServer = undefined;

    await container?.db.close();
    container = undefined;
  });

  it("relays websocket traffic through a takeover session to the upstream runtime", async () => {
    container = await createTestContainer();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);
    const sessionDal = new DesktopTakeoverSessionDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: true,
    });

    let upstreamRequestUrl = "";
    const upstreamPing = new Promise<string>((resolve) => {
      upstreamServer = createServer();
      upstreamWss = new WebSocketServer({ noServer: true });
      upstreamServer.on("upgrade", (req, socket, head) => {
        upstreamRequestUrl = req.url ?? "";
        upstreamWss!.handleUpgrade(req, socket, head, (upstreamSocket) => {
          upstreamSocket.send("hello");
          upstreamSocket.on("message", (data) => {
            const text = data.toString();
            resolve(text);
            upstreamSocket.send(`echo:${text}`);
          });
        });
      });
    });

    const upstreamPort = await listen(upstreamServer);
    const session = await sessionDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/vnc.html?autoconnect=true`,
      expiresAt: "2099-01-01T00:30:00.000Z",
    });

    const proxy = createDesktopTakeoverWsProxy({ sessionDal });
    proxyServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    proxyServer.on("upgrade", (req, socket, head) => {
      proxy.handleUpgrade(req, socket, head);
    });
    const proxyPort = await listen(proxyServer);

    const clientHello = new Promise<string>((resolve, reject) => {
      client = new WebSocket(
        `ws://127.0.0.1:${proxyPort}/desktop-takeover/s/${session.token}/websockify?token=abc`,
      );
      client.once("error", reject);
      client.on("message", (data) => {
        const text = data.toString();
        if (text === "hello") {
          resolve(text);
        }
      });
    });

    expect(await clientHello).toBe("hello");

    const clientEcho = new Promise<string>((resolve, reject) => {
      client!.once("error", reject);
      client!.on("message", (data) => {
        const text = data.toString();
        if (text === "echo:ping") {
          resolve(text);
        }
      });
    });

    client!.send("ping");

    expect(await upstreamPing).toBe("ping");
    expect(upstreamRequestUrl).toBe("/websockify?token=abc");
    expect(await clientEcho).toBe("echo:ping");
  });

  it("rejects websocket takeover paths outside the allowed asset surface", async () => {
    container = await createTestContainer();
    const hostDal = new DesktopEnvironmentHostDal(container.db);
    const environmentDal = new DesktopEnvironmentDal(container.db);
    const sessionDal = new DesktopTakeoverSessionDal(container.db);

    await hostDal.upsert({
      hostId: "host-1",
      label: "Primary runtime",
      version: "0.1.0",
      dockerAvailable: true,
      healthy: true,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    });
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Research desktop",
      imageRef: "registry.example.test/desktop:latest",
      desiredRunning: true,
    });

    const session = await sessionDal.create({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      upstreamUrl: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      expiresAt: "2099-01-01T00:30:00.000Z",
    });

    const proxy = createDesktopTakeoverWsProxy({ sessionDal });
    proxyServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    proxyServer.on("upgrade", (req, socket, head) => {
      proxy.handleUpgrade(req, socket, head);
    });
    const proxyPort = await listen(proxyServer);

    const status = await new Promise<number>((resolve, reject) => {
      const attemptedClient = new WebSocket(
        `ws://127.0.0.1:${proxyPort}/desktop-takeover/s/${session.token}/admin`,
      );
      attemptedClient.once("open", () => {
        reject(new Error("unexpected websocket upgrade"));
      });
      attemptedClient.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      attemptedClient.once("error", (error) => {
        reject(error);
      });
    });

    expect(status).toBe(404);
  });
});
