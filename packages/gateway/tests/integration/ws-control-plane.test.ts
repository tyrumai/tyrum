import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createWsHandler } from "../../src/routes/ws.js";
import { createTestContainer } from "./helpers.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import { completeHandshake } from "./ws-handshake.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";

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

describe("WS control-plane requests", () => {
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

    const authTokens = new AuthTokenService(container.db);
    const adminToken = (
      await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
    ).token;

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

    await completeHandshake(ws, { requestIdPrefix: "r", role: "client", capabilities: [] });

    ws.send(
      JSON.stringify({
        request_id: "r-help",
        type: "command.execute",
        payload: { command: "/help" },
      }),
    );
    const helpRes = await waitForJsonMessageMatching(
      ws,
      (msg) => msg["type"] === "command.execute" && Object.prototype.hasOwnProperty.call(msg, "ok"),
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

    const scopeActivity = await container.db.get<{ last_active_session_key?: string }>(
      `SELECT last_active_session_key
       FROM work_scope_activity
       WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?`,
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID],
    );
    expect(scopeActivity?.last_active_session_key).toBe(
      "agent:default:ui:default:channel:thread-1",
    );

    ws.send(
      JSON.stringify({
        request_id: "r-run",
        type: "workflow.run",
        payload: {
          key: "agent:default:main",
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
      (msg) => msg["type"] === "workflow.cancel" && Object.prototype.hasOwnProperty.call(msg, "ok"),
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

  it("resolves workflow.run snapshots against the scoped shared agent policy", async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-ws-control-plane-"));
    originalTyrumHome = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = tyrumHome;

    const container = await createTestContainer({
      deploymentConfig: { execution: { engineApiEnabled: true }, state: { mode: "shared" } },
    });
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

    const helperAgentId = await container.identityScopeDal.ensureAgentId(
      DEFAULT_TENANT_ID,
      "helper",
    );
    const policyBundles = new PolicyBundleConfigDal(container.db);
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["tool.exec"], require_approval: [], deny: [] },
      },
      createdBy: { kind: "test" },
    });
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "agent", agentId: helperAgentId },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: [], require_approval: ["tool.exec"], deny: [] },
      },
      createdBy: { kind: "test" },
    });

    const authTokens = new AuthTokenService(container.db);
    const adminToken = (
      await authTokens.issueToken({ tenantId: DEFAULT_TENANT_ID, role: "admin", scopes: ["*"] })
    ).token;

    const wsHandler = createWsHandler({
      connectionManager,
      authTokens,
      protocolDeps: {
        connectionManager,
        db: container.db,
        identityScopeDal: container.identityScopeDal,
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
    await completeHandshake(ws, { requestIdPrefix: "r", role: "client", capabilities: [] });

    ws.send(
      JSON.stringify({
        request_id: "r-run-helper",
        type: "workflow.run",
        payload: {
          key: "agent:helper:main",
          lane: "main",
          steps: [{ type: "CLI" }],
        },
      }),
    );

    const runRes = await waitForJsonMessageMatching(
      ws,
      (msg) => msg["type"] === "workflow.run" && Object.prototype.hasOwnProperty.call(msg, "ok"),
      5_000,
      "workflow.run helper",
    );
    expect(runRes["ok"], JSON.stringify(runRes)).toBe(true);

    const runResult = runRes["result"] as Record<string, unknown>;
    const job = await container.db.get<{ policy_snapshot_id: string }>(
      "SELECT policy_snapshot_id FROM execution_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, String(runResult["job_id"])],
    );
    const snapshot = await new PolicySnapshotDal(container.db).getById(
      DEFAULT_TENANT_ID,
      job!.policy_snapshot_id,
    );

    expect(snapshot?.bundle.tools?.require_approval).toContain("tool.exec");

    await agentRuntime.shutdown();
    await container.db.close();
  });
});
