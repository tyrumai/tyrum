import { afterEach, describe } from "vitest";
import { WebSocket } from "ws";
import type { Server } from "node:http";
import { rm } from "node:fs/promises";
import type { GatewayContainer } from "../../src/container.js";
import type { TestContext } from "./ws-handler.test-support.js";
import { registerWsHandlerAuthTests } from "./ws-handler.auth-test-support.js";
import { registerWsHandlerDeviceTests } from "./ws-handler.device-test-support.js";
import { registerWsHandlerPairingWsTests } from "./ws-handler.pairing-ws-test-support.js";
import { registerWsHandlerPairingHttpTests } from "./ws-handler.pairing-http-test-support.js";

describe("WS handler integration", () => {
  let server: Server | undefined;
  let homeDir: string | undefined;
  let clients: WebSocket[] = [];
  let containers: GatewayContainer[] = [];

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    clients = [];

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = undefined;
    }

    for (const container of containers) {
      await container.db.close();
    }
    containers = [];

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  const ctx: TestContext = {
    get server() { return server; },
    setServer(s) { server = s; },
    get homeDir() { return homeDir; },
    setHomeDir(d) { homeDir = d; },
    get clients() { return clients; },
    get containers() { return containers; },
  };

  registerWsHandlerAuthTests(ctx);
  registerWsHandlerDeviceTests(ctx);
  registerWsHandlerPairingWsTests(ctx);
  registerWsHandlerPairingHttpTests(ctx);
});
