import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { createContainer } from "../../src/container.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { createApp } from "../../src/app.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createDbSecretProviderFactory } from "../../src/modules/secret/create-secret-provider.js";
import { createProtocolRuntime, createWorkerLoop } from "../../src/bootstrap/runtime-builders.js";
import type { GatewayBootContext } from "../../src/bootstrap/runtime-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function makeAgents(runtime: AgentRuntime, policyService: PolicyService): AgentRegistry {
  return {
    getRuntime: async () => runtime,
    getPolicyService: () => policyService,
  } as unknown as AgentRegistry;
}

export async function startSmokeGateway(opts: {
  agentConfigText?: string;
  languageModel?: ConstructorParameters<typeof AgentRuntime>[0]["languageModel"];
  modelReply?: string;
}): Promise<{
  baseUrl: string;
  wsUrl: string;
  adminToken: string;
  stop: () => Promise<void>;
}> {
  const tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-e2e-smoke-turn-"));
  if (opts.agentConfigText) {
    await writeFile(join(tyrumHome, "agent.yml"), opts.agentConfigText, "utf-8");
  }

  const container = createContainer({
    dbPath: ":memory:",
    migrationsDir,
    tyrumHome,
  });

  const authTokens = new AuthTokenService(container.db);
  const issued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: "admin",
    scopes: ["*"],
  });
  const adminToken = issued.token;
  const secrets = await createDbSecretProviderFactory({
    db: container.db,
    dbPath: ":memory:",
    tyrumHome,
  });

  const agentRuntime = new AgentRuntime({
    container,
    home: tyrumHome,
    languageModel: opts.languageModel ?? createStubLanguageModel(opts.modelReply ?? "smoke-ok"),
  });

  const context: GatewayBootContext = {
    instanceId: "test-instance",
    role: "all",
    tyrumHome,
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    migrationsDir,
    isLocalOnly: true,
    shouldRunEdge: false,
    shouldRunWorker: true,
    deploymentConfig: container.deploymentConfig,
    container,
    logger: container.logger,
    authTokens: {} as GatewayBootContext["authTokens"],
    secretProviderForTenant: secrets.secretProviderForTenant,
    lifecycleHooks: [],
  };
  const protocol = await createProtocolRuntime(context, {
    enabled: false,
    shutdown: async () => undefined,
  });
  protocol.protocolDeps.agents = makeAgents(agentRuntime, container.policyService);
  const workerLoop = createWorkerLoop(context, protocol);

  const wsHandler = createWsHandler({
    connectionManager: protocol.connectionManager,
    protocolDeps: protocol.protocolDeps,
    authTokens,
    nodePairingDal: container.nodePairingDal,
  });

  const app = createApp(container, {
    authTokens,
    secretProviderForTenant: secrets.secretProviderForTenant,
    connectionManager: protocol.connectionManager,
    protocolDeps: protocol.protocolDeps,
    engine: protocol.edgeEngine ?? protocol.wsEngine,
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

    for (const client of protocol.connectionManager.allClients()) {
      try {
        client.ws.terminate();
      } catch {
        // ignore
      }
    }

    workerLoop?.stop();
    await workerLoop?.done;
    protocol.guardianReviewProcessor?.stop();
    protocol.approvalEngineActionProcessor?.stop();
    protocol.workSignalScheduler?.stop();
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
