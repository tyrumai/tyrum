import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createTestContainer } from "./helpers.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { PolicyService } from "../../src/modules/policy/service.js";

function authProtocols(token: string): string[] {
  return [
    "tyrum-v1",
    `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`,
  ];
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

describe("WS control-plane requests", () => {
  let server: Server | undefined;
  let ws: WebSocket | undefined;
  let tokenHome: string | undefined;
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

    if (tokenHome) {
      await rm(tokenHome, { recursive: true, force: true });
      tokenHome = undefined;
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

  it("supports session.send + workflow.run/cancel over WS", async () => {
    // Isolate policy/agent home so the test is deterministic.
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-ws-control-plane-"));
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

    tokenHome = await mkdtemp(join(tmpdir(), "tyrum-ws-token-"));
    const tokenStore = new TokenStore(tokenHome);
    const adminToken = await tokenStore.initialize();

    const wsHandler = createWsHandler({
      connectionManager,
      tokenStore,
      protocolDeps: {
        connectionManager,
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

    // Legacy connect handshake is sufficient for control-plane requests.
    ws.send(
      JSON.stringify({
        request_id: "r-connect",
        type: "connect",
        payload: { capabilities: [] },
      }),
    );
    await waitForJsonMessageMatching(
      ws,
      (msg) => msg["type"] === "connect" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "connect",
    );

    ws.send(
      JSON.stringify({
        request_id: "r-help",
        type: "command.execute",
        payload: { command: "/help" },
      }),
    );
    const helpRes = await waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "command.execute" &&
        Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "command.execute",
    );
    expect(helpRes["ok"]).toBe(true);
    expect(String((helpRes["result"] as Record<string, unknown>)["output"])).toContain(
      "Available commands",
    );

    ws.send(
      JSON.stringify({
        request_id: "r-session",
        type: "session.send",
        payload: { channel: "ui", thread_id: "thread-1", content: "hi" },
      }),
    );
    const sessionRes = await waitForJsonMessageMatching(
      ws,
      (msg) => msg["type"] === "session.send" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "session.send",
    );
    expect(sessionRes["ok"]).toBe(true);
    expect((sessionRes["result"] as Record<string, unknown>)["assistant_message"]).toBe("hello");

    ws.send(
      JSON.stringify({
        request_id: "r-run",
        type: "workflow.run",
        payload: {
          key: "agent:default:ui:main",
          lane: "main",
          steps: [{ type: "CLI" }],
        },
      }),
    );
    const runRes = await waitForJsonMessageMatching(
      ws,
      (msg) => msg["type"] === "workflow.run" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "workflow.run",
    );
    expect(runRes["ok"], JSON.stringify(runRes)).toBe(true);

    const runResult = runRes["result"] as Record<string, unknown>;
    const runId = String(runResult["run_id"]);
    expect(runId).toBeTruthy();

    const runRow = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(runRow?.status).toBe("queued");

    ws.send(
      JSON.stringify({
        request_id: "r-cancel",
        type: "workflow.cancel",
        payload: { run_id: runId, reason: "stop" },
      }),
    );
    const cancelRes = await waitForJsonMessageMatching(
      ws,
      (msg) =>
        msg["type"] === "workflow.cancel" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "workflow.cancel",
    );
    expect(cancelRes["ok"]).toBe(true);
    expect((cancelRes["result"] as Record<string, unknown>)["cancelled"]).toBe(true);

    const runRow2 = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(runRow2?.status).toBe("cancelled");

    await agentRuntime.shutdown();
    await container.db.close();
  });
});
