import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { createContainer } from "../../src/container.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createApp } from "../../src/app.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function makeAgents(runtime: AgentRuntime, policyService: PolicyService): AgentRegistry {
  return {
    getRuntime: async () => runtime,
    getPolicyService: () => policyService,
  } as unknown as AgentRegistry;
}

export async function startSmokeGateway(opts: { modelReply: string }): Promise<{
  baseUrl: string;
  wsUrl: string;
  adminToken: string;
  stop: () => Promise<void>;
}> {
  const tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-e2e-smoke-turn-"));

  const container = createContainer({
    dbPath: ":memory:",
    migrationsDir,
    tyrumHome,
  });

  const tokenStore = new TokenStore(tyrumHome);
  const adminToken = await tokenStore.initialize();

  const connectionManager = new ConnectionManager();

  const engine = new ExecutionEngine({
    db: container.db,
    redactionEngine: container.redactionEngine,
    logger: container.logger,
  });

  const agentRuntime = new AgentRuntime({
    container,
    home: tyrumHome,
    languageModel: createStubLanguageModel(opts.modelReply),
  });

  const protocolDeps: ProtocolDeps = {
    connectionManager,
    db: container.db,
    agents: makeAgents(agentRuntime, container.policyService),
    engine,
    policyService: container.policyService,
    logger: container.logger,
    redactionEngine: container.redactionEngine,
  };

  const wsHandler = createWsHandler({
    connectionManager,
    protocolDeps,
    tokenStore,
  });

  const app = createApp(container, {
    tokenStore,
    connectionManager,
    engine,
    runtime: {
      version: "test",
      instanceId: "test-instance",
      role: "all",
      otelEnabled: false,
    },
  });

  const requestListener = getRequestListener(app.fetch);
  const server: Server = createServer(requestListener);
  const sockets = new Set<Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wsHandler.handleUpgrade(req, socket, head);
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

  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const stop = async () => {
    wsHandler.stopHeartbeat();

    for (const client of connectionManager.allClients()) {
      try {
        client.ws.terminate();
      } catch {
        // ignore
      }
    }

    await agentRuntime.shutdown();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
    });
    await container.db.close();

    await rm(tyrumHome, { recursive: true, force: true });
  };

  return { baseUrl, wsUrl, adminToken, stop };
}
