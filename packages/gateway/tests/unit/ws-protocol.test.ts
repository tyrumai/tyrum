/**
 * WebSocket protocol handler tests — verifies message parsing, dispatch
 * routing, task result handling, and human response handling.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  type ActionPrimitive,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  handleClientMessage,
  dispatchTask,
  requestApproval,
  sendPlanUpdate,
  NoCapableClientError,
} from "../../src/ws/protocol.js";
import { NoCapableNodeError, NodeNotPairedError } from "../../src/ws/protocol/errors.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

// ---------------------------------------------------------------------------
// Mock WebSocket helper
// ---------------------------------------------------------------------------

type SpyLogger = NonNullable<ProtocolDeps["logger"]> & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

function createSpyLogger(): SpyLogger {
  const logger = {
    child: vi.fn((_fields: Record<string, unknown>) => logger),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger as unknown as SpyLogger;
}

function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

function makeClient(
  cm: ConnectionManager,
  capabilities: string[],
  opts?: {
    id?: string;
    role?: "client" | "node";
    deviceId?: string;
    authClaims?: unknown;
    protocolRev?: number;
  },
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const authClaims =
    opts?.authClaims ??
    ({
      token_kind: "admin",
      token_id: "token-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    } as const);
  const id = cm.addClient(ws as never, capabilities as never, { ...opts, authClaims } as never);
  return { id, ws };
}

// ---------------------------------------------------------------------------
// handleClientMessage
// ---------------------------------------------------------------------------

describe("handleClientMessage", () => {
  it("returns error for invalid JSON", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(client, "not json{{{", deps);
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_json");
  });

  it("returns error for invalid message schema", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ type: "unknown_type" }),
      deps,
    );
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_message");
  });

  it("returns error response for client-sent request envelopes", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "connect",
        payload: { capabilities: ["playwright"] },
      }),
      deps,
    );
    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe(
      "unsupported_request",
    );
  });

  it("dispatches task.execute response to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onTaskResult).toHaveBeenCalledWith(
      "t-1",
      true,
      undefined,
      { screenshot: "base64..." },
      undefined,
    );
  });

  it("rejects task.execute responses from operator clients", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-client-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(onTaskResult).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("unauthorized");
  });

  it("rejects task.execute results from an unexpected connection", async () => {
    const cm = new ConnectionManager();
    const { id: expectedConnectionId } = makeClient(cm, ["cli"], { id: "conn-1", role: "node" });
    const { id: otherConnectionId } = makeClient(cm, ["cli"], { id: "conn-2", role: "node" });
    const expected = cm.getClient(expectedConnectionId)!;
    const other = cm.getClient(otherConnectionId)!;

    const taskResults = new TaskResultRegistry();
    taskResults.associate("t-expected-1", expectedConnectionId);

    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult, taskResults });

    const unexpected = await handleClientMessage(
      other,
      JSON.stringify({
        request_id: "t-expected-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(onTaskResult).not.toHaveBeenCalled();
    expect(unexpected).toBeDefined();
    expect(unexpected!.type).toBe("error");
    const payload = (unexpected as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("unauthorized");

    const result = await handleClientMessage(
      expected,
      JSON.stringify({
        request_id: "t-expected-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onTaskResult).toHaveBeenCalledOnce();
  });

  it("fires command.execute lifecycle hooks after executing a command", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;

    const hooks = {
      fire: vi.fn(async () => undefined),
    };

    const deps = makeDeps(cm, { hooks: hooks as never });

    const res = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "command.execute",
        payload: { command: "/help" },
      }),
      deps,
    );

    expect(res).toBeDefined();
    expect((res as unknown as { ok: boolean }).ok).toBe(true);
    expect(hooks.fire).toHaveBeenCalledOnce();
    expect(hooks.fire.mock.calls[0]?.[0]).toMatchObject({
      event: "command.execute",
      metadata: { command: "/help" },
    });
  });

  it("passes command context to command.execute handlers", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "command.execute",
          payload: {
            command: "/model openai/gpt-4.1",
            channel: "ui",
            thread_id: "thread-1",
          },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      expect((res as unknown as { result: { data: unknown } }).result.data).toMatchObject({
        session_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ),
        model_id: "openai/gpt-4.1",
      });
    } finally {
      await db.close();
    }
  });

  it("dispatches task.execute error response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-2",
        type: "task.execute",
        ok: false,
        error: { code: "task_failed", message: "command failed" },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith("t-2", false, undefined, undefined, "command failed");
  });

  it("dispatches task.execute error response evidence from error details", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-3",
        type: "task.execute",
        ok: false,
        error: {
          code: "task_failed",
          message: "browser action failed",
          details: {
            evidence: { screenshot: "base64...", dom: "<html></html>" },
          },
        },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith(
      "t-3",
      false,
      undefined,
      { screenshot: "base64...", dom: "<html></html>" },
      "browser action failed",
    );
  });

  it("accepts capability.ready from nodes and broadcasts a capability.ready event", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["cli"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: operatorWs } = makeClient(cm, ["cli"], { protocolRev: 2 });
    const node = cm.getClient(nodeConnId)!;

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "approved" }) as never,
      } as never,
    });

    const result = await handleClientMessage(
      node,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect((result as unknown as { type: string }).type).toBe("capability.ready");

    const frames = operatorWs.send.mock.calls.map((call) => JSON.parse(call[0] as string)) as Array<
      Record<string, unknown>
    >;
    expect(
      frames.some(
        (msg) =>
          msg["type"] === "capability.ready" &&
          (msg["payload"] as { node_id?: string } | undefined)?.node_id === "dev_test",
      ),
    ).toBe(true);
  });

  it("logs capability.ready persistence failures (best-effort)", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["cli"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    makeClient(cm, ["cli"], { protocolRev: 2 });
    const node = cm.getClient(nodeConnId)!;

    const logger = createSpyLogger();
    const setReadyCapabilities = vi.fn(async () => {
      throw new Error("persist failed");
    });
    const enqueue = vi.fn(async () => undefined as never);

    const deps = makeDeps(cm, {
      logger,
      cluster: {
        edgeId: "edge-1",
        outboxDal: { enqueue } as never,
        connectionDirectory: { setReadyCapabilities } as never,
      },
    });

    const result = await handleClientMessage(
      node,
      JSON.stringify({
        request_id: "r-cap-ready-persist-fail-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_id: "r-cap-ready-persist-fail-1",
        client_id: node.id,
        request_type: "capability.ready",
      }),
    );
  });

  it("logs attempt.evidence node pairing lookup failures", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["cli"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const node = cm.getClient(nodeConnId)!;
    const logger = createSpyLogger();

    const deps = makeDeps(cm, {
      logger,
      nodePairingDal: {
        getByNodeId: vi.fn(async () => {
          throw new Error("db down");
        }),
      } as never,
    });

    const result = await handleClientMessage(
      node,
      JSON.stringify({
        request_id: "r-attempt-evidence-pairing-fail-1",
        type: "attempt.evidence",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          evidence: { log: "ok" },
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { type: string }).type).toBe("attempt.evidence");
    expect((result as unknown as { error: { code: string } }).error.code).toBe("unauthorized");
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_id: "r-attempt-evidence-pairing-fail-1",
        client_id: node.id,
        request_type: "attempt.evidence",
      }),
    );
  });

  it("accepts attempt.evidence from nodes and broadcasts an attempt.evidence event", async () => {
    const db = openTestSqliteDb();
    try {
      const cm = new ConnectionManager();
      const { id: nodeConnId } = makeClient(cm, ["cli"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["cli"], { protocolRev: 2 });
      const node = cm.getClient(nodeConnId)!;

      await db.run(
        `INSERT INTO execution_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           key,
           lane,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "main",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "main",
          "running",
          1,
        ],
      );
      await db.run(
        `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          1,
          "running",
          JSON.stringify({
            executor: { kind: "node", node_id: "dev_test", connection_id: nodeConnId },
          }),
        ],
      );

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () => ({ status: "approved" }) as never,
        } as never,
      });

      const result = await handleClientMessage(
        node,
        JSON.stringify({
          request_id: "r-attempt-evidence-1",
          type: "attempt.evidence",
          payload: {
            run_id: "550e8400-e29b-41d4-a716-446655440000",
            step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
            attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
            evidence: { http: { status: 200 } },
          },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("attempt.evidence");

      const frames = operatorWs.send.mock.calls.map((call) =>
        JSON.parse(call[0] as string),
      ) as Array<Record<string, unknown>>;
      expect(
        frames.some(
          (msg) =>
            msg["type"] === "attempt.evidence" &&
            (msg["payload"] as { node_id?: string } | undefined)?.node_id === "dev_test",
        ),
      ).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("rejects oversized attempt.evidence payloads", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["cli"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: operatorWs } = makeClient(cm, ["cli"], { protocolRev: 2 });
    const node = cm.getClient(nodeConnId)!;

    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      node,
      JSON.stringify({
        request_id: "r-attempt-evidence-big-1",
        type: "attempt.evidence",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          evidence: { log: "x".repeat(400_000) },
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { type: string }).type).toBe("attempt.evidence");
    expect((result as unknown as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(operatorWs.send).not.toHaveBeenCalled();
  });

  it("rejects attempt.evidence from nodes that are not the dispatched executor", async () => {
    const db = openTestSqliteDb();
    try {
      const cm = new ConnectionManager();
      const { id: executorConnId } = makeClient(cm, ["cli"], {
        role: "node",
        deviceId: "dev_executor",
        protocolRev: 2,
      });
      const { id: attackerConnId } = makeClient(cm, ["cli"], {
        role: "node",
        deviceId: "dev_attacker",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["cli"], { protocolRev: 2 });

      await db.run(
        `INSERT INTO execution_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           key,
           lane,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "main",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "main",
          "running",
          1,
        ],
      );
      await db.run(
        `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          1,
          "running",
          JSON.stringify({
            executor: { kind: "node", node_id: "dev_executor", connection_id: executorConnId },
          }),
        ],
      );

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () => ({ status: "approved" }) as never,
        } as never,
      });

      const attacker = cm.getClient(attackerConnId)!;
      const result = await handleClientMessage(
        attacker,
        JSON.stringify({
          request_id: "r-attempt-evidence-inject-1",
          type: "attempt.evidence",
          payload: {
            run_id: "550e8400-e29b-41d4-a716-446655440000",
            step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
            attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
            evidence: { log: "spoofed" },
          },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(false);
      expect((result as unknown as { type: string }).type).toBe("attempt.evidence");
      expect((result as unknown as { error: { code: string } }).error.code).toBe("unauthorized");
      expect(operatorWs.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("accepts attempt.evidence when executor metadata is missing but the node was dispatched", async () => {
    const db = openTestSqliteDb();
    try {
      const cm = new ConnectionManager();
      const { id: nodeConnId } = makeClient(cm, ["cli"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["cli"], { protocolRev: 2 });
      const node = cm.getClient(nodeConnId)!;

      await db.run(
        `INSERT INTO execution_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           key,
           lane,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "main",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "main",
          "running",
          1,
        ],
      );
      await db.run(
        `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          1,
          "running",
          null,
        ],
      );

      cm.recordDispatchedAttemptExecutor("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e", "dev_test");

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () => ({ status: "approved" }) as never,
        } as never,
      });

      const result = await handleClientMessage(
        node,
        JSON.stringify({
          request_id: "r-attempt-evidence-1",
          type: "attempt.evidence",
          payload: {
            run_id: "550e8400-e29b-41d4-a716-446655440000",
            step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
            attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
            evidence: { http: { status: 200 } },
          },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("attempt.evidence");

      const frames = operatorWs.send.mock.calls.map((call) =>
        JSON.parse(call[0] as string),
      ) as Array<Record<string, unknown>>;
      expect(
        frames.some(
          (msg) =>
            msg["type"] === "attempt.evidence" &&
            (msg["payload"] as { node_id?: string } | undefined)?.node_id === "dev_test",
        ),
      ).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("dispatches approval.request decision to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onApprovalDecision).toHaveBeenCalledWith(DEFAULT_TENANT_ID, approvalId, true, undefined);
  });

  it("dispatches approval.request rejection with reason", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: false, reason: "too risky" },
      }),
      deps,
    );

    expect(onApprovalDecision).toHaveBeenCalledWith(
      DEFAULT_TENANT_ID,
      approvalId,
      false,
      "too risky",
    );
  });

  it("forbids approval.request decisions when scoped device token lacks operator.approvals", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("forbidden");
    expect(payload.message).toContain("insufficient scope");
  });

  it("forbids approval.request ok:false responses when scoped device token lacks operator.approvals", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("forbidden");
    expect(payload.message).toContain("insufficient scope");
  });

  it("rejects approval.request ok:false responses from non-client peers", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], { role: "node" });
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("unauthorized");
    expect(payload.message).toContain("only operator clients");
  });

  it("does not auto-deny approval.request when client responds ok:false", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";
    const requestId = `approval-${approvalId}`;

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: requestId,
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } }).payload;
    expect(payload.code).toBe("approval_request_failed");
    expect(payload.message).toContain(requestId);
    expect(payload.message).toContain("payload validation failed");
  });

  it("returns error when approval.request ok payload is invalid", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: `approval-${approvalId}`,
        type: "approval.request",
        ok: true,
        result: { approved: "yes" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_approval_decision");
  });

  it("updates lastPong on ping response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    // Set lastPong to something old.
    client.lastPong = 1000;

    const before = Date.now();
    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-1", type: "ping", ok: true }),
      deps,
    );
    const after = Date.now();

    expect(result).toBeUndefined();
    expect(client.lastPong).toBeGreaterThanOrEqual(before);
    expect(client.lastPong).toBeLessThanOrEqual(after);
  });

  it("responds to ping requests with pong", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const before = Date.now();
    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-req-1", type: "ping", payload: {} }),
      deps,
    );
    const after = Date.now();

    expect(result).toEqual({
      request_id: "ping-req-1",
      type: "ping",
      ok: true,
    });
    expect(client.lastPong).toBeGreaterThanOrEqual(before);
    expect(client.lastPong).toBeLessThanOrEqual(after);
  });

  it("handles approval.list requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000aa";

    const approvalDal = {
      getPending: vi.fn(async () => {
        return [
          {
            tenant_id: DEFAULT_TENANT_ID,
            approval_id: approvalId,
            approval_key: `approval:${approvalId}`,
            agent_id: DEFAULT_AGENT_ID,
            workspace_id: DEFAULT_WORKSPACE_ID,
            kind: "policy",
            status: "pending",
            prompt: "Approve?",
            context: { x: 1 },
            created_at: "2026-02-20 22:00:00",
            expires_at: null,
            resolved_at: null,
            resolution: null,
            session_id: null,
            plan_id: null,
            run_id: null,
            step_id: null,
            attempt_id: null,
            work_item_id: null,
            work_item_task_id: null,
            resume_token: null,
          },
        ];
      }),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => undefined),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        approvals: Array<{ approval_id: string; created_at: string; resolution: unknown }>;
      };
    };
    expect(res.result.approvals).toHaveLength(1);
    expect(res.result.approvals[0]!.approval_id).toBe(approvalId);
    expect(res.result.approvals[0]!.created_at).toContain("T");
    expect(res.result.approvals[0]!.created_at).toContain("Z");
    expect(res.result.approvals[0]!.resolution).toBeNull();
  });

  it("rejects approval.list when peer role is node", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => undefined),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("handles approval.resolve requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ab";

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          approval_id: approvalId,
          approval_key: `approval:${approvalId}`,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          kind: "policy",
          status: "approved",
          prompt: "Ok?",
          context: {},
          created_at: "2026-02-20 22:00:00",
          expires_at: null,
          resolved_at: "2026-02-20 22:00:05",
          resolution: {
            decision: "approved",
            resolved_at: "2026-02-20T22:00:05Z",
            reason: "looks good",
          },
          session_id: null,
          plan_id: null,
          run_id: null,
          step_id: null,
          attempt_id: null,
          work_item_id: null,
          work_item_task_id: null,
          resume_token: null,
        };
      }),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-2",
        type: "approval.resolve",
        payload: { approval_id: approvalId, decision: "approved", reason: "looks good" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        approval: { approval_id: string; status: string; resolution: { decision: string } };
      };
    };
    expect(res.result.approval.approval_id).toBe(approvalId);
    expect(res.result.approval.status).toBe("approved");
    expect(res.result.approval.resolution.decision).toBe("approved");
  });

  it("does not create approve-always overrides when the approval resolves to denied", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ac";

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          approval_id: approvalId,
          approval_key: `approval:${approvalId}`,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          kind: "policy",
          status: "pending",
          prompt: "Ok?",
          context: {
            policy: {
              agent_id: DEFAULT_AGENT_ID,
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                {
                  tool_id: "tool.exec",
                  pattern: "echo hi",
                  workspace_id: DEFAULT_WORKSPACE_ID,
                },
              ],
            },
          },
          created_at: "2026-02-20 22:00:00",
          expires_at: null,
          resolved_at: null,
          resolution: null,
          session_id: null,
          plan_id: null,
          run_id: null,
          step_id: null,
          attempt_id: null,
          work_item_id: null,
          work_item_task_id: null,
          resume_token: null,
        };
      }),
      respond: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          approval_id: approvalId,
          approval_key: `approval:${approvalId}`,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          kind: "policy",
          status: "denied",
          prompt: "Ok?",
          context: {},
          created_at: "2026-02-20 22:00:00",
          expires_at: null,
          resolved_at: "2026-02-20 22:00:05",
          resolution: {
            decision: "denied",
            resolved_at: "2026-02-20T22:00:05Z",
            reason: "no",
          },
          session_id: null,
          plan_id: null,
          run_id: null,
          step_id: null,
          attempt_id: null,
          work_item_id: null,
          work_item_task_id: null,
          resume_token: null,
        };
      }),
    };

    const policyOverrideDal = {
      create: vi.fn(async () => {
        return {
          policy_override_id: "00000000-0000-4000-8000-000000000001",
          status: "active",
          created_at: new Date().toISOString(),
          created_by: { kind: "ws" },
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          tool_id: "tool.exec",
          pattern: "echo hi",
          created_from_approval_id: approvalId,
          created_from_policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
        };
      }),
    };

    const deps = makeDeps(cm, {
      approvalDal: approvalDal as never,
      policyOverrideDal: policyOverrideDal as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-3",
        type: "approval.resolve",
        payload: {
          approval_id: approvalId,
          decision: "approved",
          mode: "always",
          overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: { approval: { status: string }; created_overrides?: unknown[] };
    };
    expect(res.result.approval.status).toBe("denied");
    expect(res.result.created_overrides).toBeUndefined();
    expect(policyOverrideDal.create).not.toHaveBeenCalled();
  });

  it("rejects approve-always override selection when the pattern violates guardrails", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ad";

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          approval_id: approvalId,
          approval_key: `approval:${approvalId}`,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          kind: "policy",
          status: "pending",
          prompt: "Ok?",
          context: {
            policy: {
              agent_id: DEFAULT_AGENT_ID,
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                {
                  tool_id: "tool.exec",
                  pattern: "echo *",
                  workspace_id: DEFAULT_WORKSPACE_ID,
                },
              ],
            },
          },
          created_at: "2026-02-20 22:00:00",
          expires_at: null,
          resolved_at: null,
          resolution: null,
          session_id: null,
          plan_id: null,
          run_id: null,
          step_id: null,
          attempt_id: null,
          work_item_id: null,
          work_item_task_id: null,
          resume_token: null,
        };
      }),
      respond: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          approval_id: approvalId,
          approval_key: `approval:${approvalId}`,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          kind: "policy",
          status: "approved",
          prompt: "Ok?",
          context: {},
          created_at: "2026-02-20 22:00:00",
          expires_at: null,
          resolved_at: "2026-02-20 22:00:05",
          resolution: {
            decision: "approved",
            resolved_at: "2026-02-20T22:00:05Z",
            reason: "looks good",
          },
          session_id: null,
          plan_id: null,
          run_id: null,
          step_id: null,
          attempt_id: null,
          work_item_id: null,
          work_item_task_id: null,
          resume_token: null,
        };
      }),
    };

    const policyOverrideDal = {
      create: vi.fn(async () => {
        return {
          policy_override_id: "00000000-0000-4000-8000-000000000001",
          status: "active",
          created_at: new Date().toISOString(),
          created_by: { kind: "ws" },
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          tool_id: "tool.exec",
          pattern: "echo *",
          created_from_approval_id: approvalId,
          created_from_policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
        };
      }),
    };

    const deps = makeDeps(cm, {
      approvalDal: approvalDal as never,
      policyOverrideDal: policyOverrideDal as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-4",
        type: "approval.resolve",
        payload: {
          approval_id: approvalId,
          decision: "approved",
          mode: "always",
          overrides: [
            { tool_id: "tool.exec", pattern: "echo *", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    const err = result as unknown as { error: { code: string; message: string } };
    expect(err.error.code).toBe("invalid_request");
    expect(policyOverrideDal.create).not.toHaveBeenCalled();
  });

  it("rejects pairing.approve when trust_level is missing", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const nodePairingDal = { resolve: vi.fn(async () => undefined) };
    const deps = makeDeps(cm, { nodePairingDal: nodePairingDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-approve-1",
        type: "pairing.approve",
        payload: { pairing_id: 1, capability_allowlist: [] },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
  });

  it("rejects pairing.approve when capability_allowlist is missing", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const nodePairingDal = { resolve: vi.fn(async () => undefined) };
    const deps = makeDeps(cm, { nodePairingDal: nodePairingDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-approve-2",
        type: "pairing.approve",
        payload: { pairing_id: 1, trust_level: "remote" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
  });

  it("forbids command.execute when scoped device token lacks operator.admin", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
    });
    const client = cm.getClient(id)! as unknown as { auth_claims?: unknown };
    client.auth_claims = {
      token_kind: "device",
      token_id: "token-device-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "client",
      device_id: "dev_client_1",
      scopes: ["operator.read"],
    };

    const deps = makeDeps(cm);
    const result = await handleClientMessage(
      cm.getClient(id)!,
      JSON.stringify({ request_id: "r-1", type: "command.execute", payload: { command: "/help" } }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("allows command.execute when scoped device token includes operator.admin", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-device-2",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.admin"],
      },
    });
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-1", type: "command.execute", payload: { command: "/help" } }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect(String((result as unknown as { result: { output?: string } }).result.output)).toContain(
      "Available commands",
    );
  });

  it("denies unmapped request types by default for scoped device tokens", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-device-3",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.admin"],
      },
    });
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-1", type: "connect", payload: { capabilities: [] } }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("does not forbid presence.beacon when no scopes are required", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: [],
      },
    });
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-1", type: "presence.beacon", payload: {} }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe(
      "unsupported_request",
    );
  });

  it("logs presence.beacon broadcast send failures (best-effort)", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
    });
    const client = cm.getClient(id)!;

    const { ws: throwingPeerWs } = makeClient(cm, ["cli"], { protocolRev: 2 });
    throwingPeerWs.send.mockImplementation(() => {
      throw new Error("send failed");
    });

    const logger = createSpyLogger();
    const deps = makeDeps(cm, {
      logger,
      presenceDal: {
        upsert: vi.fn(async () => ({
          instance_id: "dev_client_1",
          role: "client",
          connection_id: id,
          host: null,
          ip: null,
          version: null,
          mode: null,
          last_input_seconds: null,
          metadata: {},
          connected_at_ms: Date.now(),
          last_seen_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60_000,
        })),
      } as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-presence-beacon-1", type: "presence.beacon", payload: {} }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect((result as unknown as { type: string }).type).toBe("presence.beacon");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_id: "r-presence-beacon-1",
        client_id: client.id,
        request_type: "presence.beacon",
      }),
    );
  });

  it("does not forbid ping when no scopes are required", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: [],
      },
    });
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-ping-1", type: "ping", payload: {} }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect((result as unknown as { type: string }).type).toBe("ping");
  });
});

// ---------------------------------------------------------------------------
// dispatchTask
// ---------------------------------------------------------------------------

describe("dispatchTask", () => {
  it("never selects a capability-providing client for task.execute", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["cli"], { protocolRev: 2 });
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableNodeError);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("sends task.execute request to a paired capable node", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"], {
      role: "node",
      deviceId: "dev_web_test",
      protocolRev: 2,
    });
    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("playwright"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "Web",
      args: { url: "https://example.com" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      request_id: taskId,
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Web", args: { url: "https://example.com" } },
      },
    });
  });

  it("dispatches to a paired node before it signals readiness (backward-compatible)", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(cm.getDispatchedAttemptExecutor("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e")).toBe(
      "dev_test",
    );
  });

  it("persists execution attempt executor metadata when dispatching to a node", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO execution_jobs (
           tenant_id,
           job_id,
           agent_id,
           workspace_id,
           key,
           lane,
           status,
           trigger_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "job-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "agent:default",
          "main",
          "running",
          "{}",
        ],
      );
      await db.run(
        `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "550e8400-e29b-41d4-a716-446655440000",
          "job-1",
          "agent:default",
          "main",
          "running",
          1,
        ],
      );
      await db.run(
        `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          1,
          "running",
        ],
      );

      const cm = new ConnectionManager();
      const nodeWs = createMockWs();
      cm.addClient(nodeWs as never, ["cli"] as never, {
        id: "node-1",
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-node-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "node",
          device_id: "dev_test",
          scopes: [],
        },
      });

      const deps = makeDeps(cm, {
        db,
        nodePairingDal: {
          getByNodeId: async () =>
            ({
              status: "approved",
              capability_allowlist: [
                {
                  id: descriptorIdForClientCapability("cli"),
                  version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
                },
              ],
            }) as never,
        } as never,
      });

      await dispatchTask(
        { type: "CLI", args: { command: "echo hi" } },
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      );

      const row = await db.get<{ metadata_json: string | null }>(
        "SELECT metadata_json FROM execution_attempts WHERE attempt_id = ?",
        ["0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e"],
      );
      expect(row).toBeDefined();
      const meta = JSON.parse(row!.metadata_json ?? "{}") as {
        executor?: { kind?: string; node_id?: string; connection_id?: string };
      };
      expect(meta.executor?.kind).toBe("node");
      expect(meta.executor?.node_id).toBe("dev_test");
      expect(meta.executor?.connection_id).toBe("node-1");
    } finally {
      await db.close();
    }
  });

  it("stops dispatching to a paired node when it reports readiness removed", async () => {
    const cm = new ConnectionManager();
    const { ws: nodeWs } = makeClient(cm, ["cli"], {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );
    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-2",
        type: "capability.ready",
        payload: { capabilities: [] },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableNodeError);
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("filters cluster directory entries by protocol_rev >= 2", async () => {
    const cm = new ConnectionManager();
    const outboxDal = { enqueue: vi.fn(async () => undefined) };
    const connectionDirectory = {
      listConnectionsForCapability: vi.fn(async () => {
        return [
          {
            connection_id: "conn-v1",
            edge_id: "edge-a",
            role: "node",
            protocol_rev: 1,
            device_id: "dev-1",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: ["cli"],
            ready_capabilities: ["cli"],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
          {
            connection_id: "conn-v2",
            edge_id: "edge-a",
            role: "node",
            protocol_rev: 2,
            device_id: "dev-2",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: ["cli"],
            ready_capabilities: ["cli"],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
        ];
      }),
    };

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
      cluster: {
        edgeId: "edge-b",
        outboxDal: outboxDal as never,
        connectionDirectory: connectionDirectory as never,
      },
    });

    const action: ActionPrimitive = { type: "CLI", args: {} };

    await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );

    expect(outboxDal.enqueue).toHaveBeenCalledOnce();
    const payload = outboxDal.enqueue.mock.calls[0]![2] as {
      connection_id: string;
    };
    expect(payload.connection_id).toBe("conn-v2");
  });

  it("does not dispatch to an unpaired node", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("throws NodeNotPairedError when local node is unpaired and cluster has no candidates", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["desktop"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const outboxDal = { enqueue: vi.fn(async () => undefined) };
    const connectionDirectory = {
      listConnectionsForCapability: vi.fn(async () => []),
    };

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
      cluster: {
        edgeId: "edge-local",
        outboxDal: outboxDal as never,
        connectionDirectory: connectionDirectory as never,
      },
    });

    await expect(
      dispatchTask(
        { type: "Desktop", args: {} },
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(outboxDal.enqueue).not.toHaveBeenCalled();
  });

  it("dispatches to a paired node and prefers nodes over legacy clients", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: legacyWs } = makeClient(cm, ["cli"]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();
    legacyWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("does not dispatch to a node when its pairing allowlist excludes the capability", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: clientWs } = makeClient(cm, ["cli"], { protocolRev: 2 });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("http"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).not.toHaveBeenCalled();
  });

  it("does not dispatch to a node when its pairing allowlist version excludes the capability", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: clientWs } = makeClient(cm, ["cli"], { protocolRev: 2 });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: "2.0.0",
              },
            ],
          }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).not.toHaveBeenCalled();
  });

  it("throws NodeDispatchDeniedError when policy denies node dispatch", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(async () => {
          return {
            decision: "deny",
            policy_snapshot: { policy_snapshot_id: "snap-1" },
          };
        }),
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toMatchObject({ name: "NodeDispatchDeniedError" });
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("includes policy snapshot metadata in node dispatch trace", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () =>
          ({
            status: "approved",
            capability_allowlist: [
              {
                id: descriptorIdForClientCapability("cli"),
                version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
              },
            ],
          }) as never,
      } as never,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(async () => {
          return {
            decision: "allow",
            policy_snapshot: { policy_snapshot_id: "snap-1" },
          };
        }),
      } as never,
    });

    await handleClientMessage(
      cm.getClient("node-1")!,
      JSON.stringify({
        request_id: "r-cap-ready-1",
        type: "capability.ready",
        payload: {
          capabilities: [
            {
              id: descriptorIdForClientCapability("cli"),
              version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
            },
          ],
        },
      }),
      deps,
    );
    nodeWs.send.mockClear();

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(
      action,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(nodeWs.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent["trace"]).toMatchObject({
      policy_snapshot_id: "snap-1",
      policy_decision: "allow",
    });
  });

  it("does not dispatch tasks to legacy clients", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev_test",
        scopes: [],
      },
    });
    const { ws: legacyWs } = makeClient(cm, ["cli"]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NodeNotPairedError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("throws NoCapableNodeError when no node has the capability", () => {
    const cm = new ConnectionManager();
    makeClient(cm, ["cli"]); // Only CLI capability
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableNodeError);
  });

  it("throws NoCapableNodeError when no nodes are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Http",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableNodeError);
  });

  it("throws NoCapableClientError for unmapped action type", () => {
    const cm = new ConnectionManager();
    makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    // "Research" has no capability mapping
    const action: ActionPrimitive = {
      type: "Research",
      args: {},
    };

    expect(() =>
      dispatchTask(
        action,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableClientError);
  });
});

// ---------------------------------------------------------------------------
// requestApproval
// ---------------------------------------------------------------------------

describe("requestApproval", () => {
  it("sends approval.request to the first client", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      DEFAULT_TENANT_ID,
      {
        approval_id: "7",
        approval_key: "approval-7",
        kind: "tool.exec",
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
      deps,
    );

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      request_id: "approval-7",
      type: "approval.request",
      payload: {
        approval_id: "7",
        approval_key: "approval-7",
        kind: "tool.exec",
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
    });
  });

  it("skips node peers when selecting an approval recipient", () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(
      nodeWs as never,
      ["playwright"] as never,
      {
        id: "node-1",
        role: "node",
        protocolRev: 2,
        authClaims: { token_kind: "admin", role: "admin", scopes: ["*"] },
      } as never,
    );

    const { ws: operatorWs } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      DEFAULT_TENANT_ID,
      {
        approval_id: "7",
        approval_key: "approval-7",
        kind: "tool.exec",
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
      deps,
    );

    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(operatorWs.send).toHaveBeenCalledOnce();
  });

  it("skips scoped clients without operator.approvals when selecting an approval recipient", () => {
    const cm = new ConnectionManager();
    const { ws: unscopedWs } = makeClient(cm, ["playwright"], {
      role: "client",
      deviceId: "dev_client_1",
      protocolRev: 2,
      authClaims: {
        token_kind: "device",
        token_id: "token-device-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const { ws: operatorWs } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      DEFAULT_TENANT_ID,
      {
        approval_id: "7",
        approval_key: "approval-7",
        kind: "tool.exec",
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
      deps,
    );

    expect(unscopedWs.send).not.toHaveBeenCalled();
    expect(operatorWs.send).toHaveBeenCalledOnce();
  });

  it("does nothing when no clients are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    // Should not throw.
    requestApproval(
      DEFAULT_TENANT_ID,
      {
        approval_id: "1",
        approval_key: "approval-1",
        kind: "tool.exec",
        prompt: "Approve?",
        context: null,
        expires_at: null,
      },
      deps,
    );
  });
});

// ---------------------------------------------------------------------------
// sendPlanUpdate
// ---------------------------------------------------------------------------

describe("sendPlanUpdate", () => {
  it("broadcasts plan.update events to all connected clients", () => {
    const cm = new ConnectionManager();
    const { ws: ws1 } = makeClient(cm, ["playwright"]);
    const { ws: ws2 } = makeClient(cm, ["cli"]);
    const deps = makeDeps(cm);

    sendPlanUpdate(DEFAULT_TENANT_ID, "plan-1", "executing", deps, "step 2 of 5");

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent["type"]).toBe("plan.update");
    expect(typeof sent["event_id"]).toBe("string");
    expect(typeof sent["occurred_at"]).toBe("string");
    expect(sent["payload"]).toEqual({
      plan_id: "plan-1",
      status: "executing",
      detail: "step 2 of 5",
    });
  });

  it("sends plan.update without detail", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    sendPlanUpdate(DEFAULT_TENANT_ID, "plan-1", "completed", deps);

    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent["type"]).toBe("plan.update");
    expect((sent["payload"] as Record<string, unknown>)["plan_id"]).toBe("plan-1");
    expect((sent["payload"] as Record<string, unknown>)["status"]).toBe("completed");
  });
});
