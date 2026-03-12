import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/schemas";
import { createApp } from "../../src/app.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { createTestContainer } from "./helpers.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import { completeHandshake } from "./ws-handshake.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";

function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("open timeout")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForJsonMessageMatching(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
  label = "unknown",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`message timeout (${label})`));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (!predicate(msg)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.on("message", onMessage);
  });
}

function makeAgents(runtime: AgentRuntime, policyService: PolicyService): AgentRegistry {
  return {
    getRuntime: async () => runtime,
    getPolicyService: () => policyService,
  } as unknown as AgentRegistry;
}

describe("WS session lane node attachment", () => {
  let server: Server | undefined;
  let ws: WebSocket | undefined;
  let tyrumHome: string | undefined;
  let originalTyrumHome: string | undefined;
  let stopHeartbeat: (() => void) | undefined;

  afterEach(async () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
    ws = undefined;

    stopHeartbeat?.();
    stopHeartbeat = undefined;

    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }

    if (tyrumHome) {
      await rm(tyrumHome, { recursive: true, force: true });
      tyrumHome = undefined;
    }

    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }
    originalTyrumHome = undefined;
  });

  it("persists and clears lane node attachment metadata and exposes it via /nodes", async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-ws-node-attachment-"));
    originalTyrumHome = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = tyrumHome;

    const container = await createTestContainer();
    const connectionManager = new ConnectionManager();
    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
    });
    const agentRuntime = new AgentRuntime({
      container,
      home: tyrumHome,
      languageModel: createStubLanguageModel("hello"),
    });

    const authTokens = new AuthTokenService(container.db);
    const adminToken = (
      await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
    ).token;

    const pendingPairing = await container.nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId: "node-1",
      label: "node-1",
      capabilities: [{ id: "tyrum.desktop.snapshot", version: "1.0.0" }],
      metadata: { mode: "desktop", version: "1.0.0" },
    });
    await container.nodePairingDal.resolve({
      tenantId: DEFAULT_TENANT_ID,
      pairingId: pendingPairing.pairing_id,
      decision: "approved",
      trustLevel: "local",
      capabilityAllowlist: [
        {
          id: "tyrum.desktop.snapshot",
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });

    const httpApp = createApp(container, {
      runtime: {
        version: "test",
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
      authTokens,
      connectionManager,
    });

    const wsHandler = createWsHandler({
      connectionManager,
      authTokens,
      protocolDeps: {
        connectionManager,
        db: container.db,
        agents: makeAgents(agentRuntime, container.policyService),
        engine,
        policyService: container.policyService,
      },
    });
    stopHeartbeat = wsHandler.stopHeartbeat;

    server = createServer();
    server.on("upgrade", (req, socket, head) => {
      wsHandler.handleUpgrade(req, socket, head);
    });

    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, authProtocols(adminToken));
    await waitForOpen(ws);

    const handshake = await completeHandshake(ws, {
      requestIdPrefix: "r",
      role: "client",
      capabilities: [],
    });

    const key = "agent:default:ui:default:channel:thread-1";

    ws.send(
      JSON.stringify({
        request_id: "r-session-attach",
        type: "session.send",
        payload: {
          channel: "ui",
          thread_id: "thread-1",
          content: "attach",
          attached_node_id: "node-1",
        },
      }),
    );
    const attachRes = await waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "session.send" &&
        msg["request_id"] === "r-session-attach" &&
        Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "session.send attach",
    );
    expect(attachRes["ok"]).toBe(true);

    const attachedRow = await container.db.get<{
      source_client_device_id: string | null;
      attached_node_id: string | null;
    }>(
      `SELECT source_client_device_id, attached_node_id
       FROM session_lane_node_attachments
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, key, "main"],
    );
    expect(attachedRow).toEqual({
      source_client_device_id: handshake.deviceId,
      attached_node_id: "node-1",
    });

    const attachedNodesRes = await httpApp.request(
      `/nodes?key=${encodeURIComponent(key)}&lane=main&dispatchable_only=false`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(attachedNodesRes.status).toBe(200);
    const attachedPayload = (await attachedNodesRes.json()) as {
      nodes: Array<Record<string, unknown>>;
    };
    const attachedNode = attachedPayload.nodes.find((node) => node["node_id"] === "node-1");
    expect(attachedNode).toBeDefined();
    expect(attachedNode?.["attached_to_requested_lane"]).toBe(true);
    expect(attachedNode?.["source_client_device_id"]).toBe(handshake.deviceId);

    ws.send(
      JSON.stringify({
        request_id: "r-session-clear",
        type: "session.send",
        payload: {
          channel: "ui",
          thread_id: "thread-1",
          content: "clear",
        },
      }),
    );
    const clearRes = await waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "session.send" &&
        msg["request_id"] === "r-session-clear" &&
        Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "session.send clear",
    );
    expect(clearRes["ok"]).toBe(true);

    const clearedRow = await container.db.get<{
      source_client_device_id: string | null;
      attached_node_id: string | null;
    }>(
      `SELECT source_client_device_id, attached_node_id
       FROM session_lane_node_attachments
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [DEFAULT_TENANT_ID, key, "main"],
    );
    expect(clearedRow).toEqual({
      source_client_device_id: handshake.deviceId,
      attached_node_id: null,
    });

    const clearedNodesRes = await httpApp.request(
      `/nodes?key=${encodeURIComponent(key)}&lane=main&dispatchable_only=false`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(clearedNodesRes.status).toBe(200);
    const clearedPayload = (await clearedNodesRes.json()) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(clearedPayload.nodes.some((node) => node["attached_to_requested_lane"] === true)).toBe(
      false,
    );

    await agentRuntime.shutdown();
    await container.db.close();
  });
});
