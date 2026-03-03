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
import { NodeNotPairedError } from "../../src/ws/protocol/errors.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

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
    const { id } = makeClient(cm, ["playwright"]);
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
            agent_id: "default",
            channel: "ui",
            thread_id: "thread-1",
          },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      expect((res as unknown as { result: { data: unknown } }).result.data).toMatchObject({
        session_id: "ui:thread-1",
        model_id: "openai/gpt-4.1",
      });
    } finally {
      await db.close();
    }
  });

  it("dispatches task.execute error response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
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
    const { id } = makeClient(cm, ["cli"]);
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
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
        ["job-1", "agent:default", "default", "running", "{}"],
      );
      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?)`,
        ["550e8400-e29b-41d4-a716-446655440000", "job-1", "agent:default", "default", "running", 1],
      );
      await db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, ?, ?, ?)`,
        [
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
        [
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
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
         VALUES (?, ?, ?, ?, ?)`,
        ["job-1", "agent:default", "default", "running", "{}"],
      );
      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["550e8400-e29b-41d4-a716-446655440000", "job-1", "agent:default", "default", "running", 1],
      );
      await db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
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
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
         VALUES (?, ?, ?, ?, ?)`,
        ["job-1", "agent:default", "default", "running", "{}"],
      );
      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["550e8400-e29b-41d4-a716-446655440000", "job-1", "agent:default", "default", "running", 1],
      );
      await db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
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

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-123",
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onApprovalDecision).toHaveBeenCalledWith(123, true, undefined);
  });

  it("dispatches approval.request rejection with reason", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-124",
        type: "approval.request",
        ok: true,
        result: { approved: false, reason: "too risky" },
      }),
      deps,
    );

    expect(onApprovalDecision).toHaveBeenCalledWith(124, false, "too risky");
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

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-123",
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

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-200",
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

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-200",
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

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-200",
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
    expect(payload.message).toContain("approval-200");
    expect(payload.message).toContain("payload validation failed");
  });

  it("returns error when approval.request ok payload is invalid", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-125",
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

    const approvalDal = {
      getPending: vi.fn(async () => {
        return [
          {
            id: 1,
            plan_id: "p-1",
            step_index: 0,
            prompt: "Approve?",
            context: { x: 1 },
            status: "pending",
            created_at: "2026-02-20 22:00:00",
            responded_at: null,
            response_reason: null,
            expires_at: null,
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
        approvals: Array<{ approval_id: number; created_at: string; resolution: unknown }>;
      };
    };
    expect(res.result.approvals[0]!.approval_id).toBe(1);
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

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {},
          status: "approved",
          created_at: "2026-02-20 22:00:00",
          responded_at: "2026-02-20 22:00:05",
          response_reason: "looks good",
          expires_at: null,
        };
      }),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-2",
        type: "approval.resolve",
        payload: { approval_id: 2, decision: "approved", reason: "looks good" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        approval: { approval_id: number; status: string; resolution: { decision: string } };
      };
    };
    expect(res.result.approval.approval_id).toBe(2);
    expect(res.result.approval.status).toBe("approved");
    expect(res.result.approval.resolution.decision).toBe("approved");
  });

  it("does not create approve-always overrides when the approval resolves to denied", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {
            policy: {
              agent_id: "agent-1",
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                { tool_id: "tool.exec", pattern: "echo hi", workspace_id: "default" },
              ],
            },
          },
          status: "pending",
          created_at: "2026-02-20 22:00:00",
          responded_at: null,
          response_reason: null,
          expires_at: null,
        };
      }),
      respond: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {},
          status: "denied",
          created_at: "2026-02-20 22:00:00",
          responded_at: "2026-02-20 22:00:05",
          response_reason: "no",
          expires_at: null,
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
          agent_id: "agent-1",
          workspace_id: "default",
          tool_id: "tool.exec",
          pattern: "echo hi",
          created_from_approval_id: 2,
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
          approval_id: 2,
          decision: "approved",
          mode: "always",
          overrides: [{ tool_id: "tool.exec", pattern: "echo hi", workspace_id: "default" }],
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

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {
            policy: {
              agent_id: "agent-1",
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                { tool_id: "tool.exec", pattern: "echo *", workspace_id: "default" },
              ],
            },
          },
          status: "pending",
          created_at: "2026-02-20 22:00:00",
          responded_at: null,
          response_reason: null,
          expires_at: null,
        };
      }),
      respond: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {},
          status: "approved",
          created_at: "2026-02-20 22:00:00",
          responded_at: "2026-02-20 22:00:05",
          response_reason: "looks good",
          expires_at: null,
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
          agent_id: "agent-1",
          workspace_id: "default",
          tool_id: "tool.exec",
          pattern: "echo *",
          created_from_approval_id: 2,
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
          approval_id: 2,
          decision: "approved",
          mode: "always",
          overrides: [{ tool_id: "tool.exec", pattern: "echo *", workspace_id: "default" }],
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

  it("creates ui sessions via session.create", async () => {
    const db = openTestSqliteDb();
    try {
      const cm = new ConnectionManager();
      const { id } = makeClient(cm, ["cli"]);
      const client = cm.getClient(id)!;
      const deps = makeDeps(cm, { db });

      const result = await handleClientMessage(
        client,
        JSON.stringify({ request_id: "r-session-create-1", type: "session.create", payload: {} }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("session.create");

      const created = (result as unknown as { result: { session_id: string; thread_id: string } })
        .result;
      expect(created.session_id).toMatch(/^ui:/);
      expect(created.thread_id).toMatch(/^ui-/);

      const row = await db.get<{ channel: string; thread_id: string }>(
        `SELECT channel, thread_id
         FROM sessions
         WHERE agent_id = ? AND session_id = ?`,
        ["default", created.session_id],
      );
      expect(row).toEqual({ channel: "ui", thread_id: created.thread_id });
    } finally {
      await db.close();
    }
  });

  it("lists ui sessions via session.list ordered by updated_at desc", async () => {
    const db = openTestSqliteDb();
    try {
      const nowIso = new Date().toISOString();
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
        ["default", "ui:thread-old", "ui", "thread-old", pastIso, pastIso],
      );
      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
        ["default", "ui:thread-new", "ui", "thread-new", nowIso, nowIso],
      );
      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', '[]', ?, ?)`,
        ["default", "telegram:dm-1", "telegram", "dm-1", nowIso, nowIso],
      );

      const cm = new ConnectionManager();
      const { id } = makeClient(cm, ["cli"]);
      const client = cm.getClient(id)!;
      const deps = makeDeps(cm, { db });

      const result = await handleClientMessage(
        client,
        JSON.stringify({ request_id: "r-session-list-1", type: "session.list", payload: {} }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      const sessions = (
        result as unknown as { result: { sessions: Array<{ session_id: string }> } }
      ).result.sessions;
      expect(sessions.map((s) => s.session_id)).toEqual(["ui:thread-new", "ui:thread-old"]);
    } finally {
      await db.close();
    }
  });

  it("returns transcripts via session.get", async () => {
    const db = openTestSqliteDb();
    try {
      const nowIso = new Date().toISOString();
      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?)`,
        [
          "default",
          "ui:thread-1",
          "ui",
          "thread-1",
          JSON.stringify([
            { role: "user", content: "hi", timestamp: nowIso },
            { role: "assistant", content: "hello", timestamp: nowIso },
          ]),
          nowIso,
          nowIso,
        ],
      );

      const cm = new ConnectionManager();
      const { id } = makeClient(cm, ["cli"]);
      const client = cm.getClient(id)!;
      const deps = makeDeps(cm, { db });

      const result = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-session-get-1",
          type: "session.get",
          payload: { session_id: "ui:thread-1" },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("session.get");

      const turns = (
        result as unknown as {
          result: { session: { turns: Array<{ role: string; content: string }> } };
        }
      ).result.session.turns;
      expect(turns).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]);
    } finally {
      await db.close();
    }
  });

  it("compacts sessions via session.compact", async () => {
    const db = openTestSqliteDb();
    try {
      const nowIso = new Date().toISOString();
      const turns = Array.from({ length: 12 }, (_, idx) => ({
        role: idx % 2 === 0 ? "user" : "assistant",
        content: `msg-${idx}`,
        timestamp: nowIso,
      }));
      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'prev', ?, ?, ?)`,
        [
          "default",
          "ui:thread-compact",
          "ui",
          "thread-compact",
          JSON.stringify(turns),
          nowIso,
          nowIso,
        ],
      );

      const cm = new ConnectionManager();
      const { id } = makeClient(cm, ["cli"]);
      const client = cm.getClient(id)!;
      const deps = makeDeps(cm, { db });

      const result = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-session-compact-1",
          type: "session.compact",
          payload: { session_id: "ui:thread-compact", keep_last_messages: 4 },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("session.compact");
      expect(
        (result as unknown as { result: { dropped_messages: number; kept_messages: number } })
          .result,
      ).toMatchObject({ dropped_messages: 8, kept_messages: 4 });

      const updated = await db.get<{ turns_json: string; summary: string }>(
        `SELECT turns_json, summary
         FROM sessions
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-compact"],
      );
      expect(updated?.summary).toContain("prev");
      expect(updated?.summary).toContain("msg-0");
      expect(JSON.parse(updated?.turns_json ?? "[]")).toHaveLength(4);
    } finally {
      await db.close();
    }
  });

  it("deletes sessions via session.delete and clears overrides + cancels active work", async () => {
    const db = openTestSqliteDb();
    try {
      const nowIso = new Date().toISOString();

      await db.run(
        `INSERT INTO sessions (agent_id, session_id, channel, thread_id, summary, turns_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "default",
          "ui:thread-1",
          "ui",
          "thread-1",
          "to-delete",
          JSON.stringify([{ role: "user", content: "hi", timestamp: "t-1" }]),
          nowIso,
          nowIso,
        ],
      );

      await db.run(
        `INSERT INTO session_model_overrides (agent_id, session_id, model_id, updated_at)
         VALUES (?, ?, ?, ?)`,
        ["default", "ui:thread-1", "openai/gpt-4.1", nowIso],
      );

      await db.run(
        `INSERT INTO auth_profiles (
           profile_id,
           agent_id,
           provider,
           type,
           secret_handles_json,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'api_key', ?, 'active', ?, ?)`,
        [
          "profile-openai-1",
          "default",
          "openai",
          JSON.stringify({ api_key_handle: "handle-openai-1" }),
          nowIso,
          nowIso,
        ],
      );

      await db.run(
        `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id, pinned_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["default", "ui:thread-1", "openai", "profile-openai-1", nowIso, nowIso],
      );

      const key = "agent:default:ui:default:channel:thread-1";
      const lane = "main";

      await db.run(
        `INSERT INTO lane_queue_mode_overrides (key, lane, queue_mode, updated_at_ms)
         VALUES (?, ?, 'interrupt', ?)`,
        [key, lane, Date.now()],
      );
      await db.run(
        `INSERT INTO session_send_policy_overrides (key, send_policy, updated_at_ms)
         VALUES (?, 'off', ?)`,
        [key, Date.now()],
      );

      await db.run(
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
         VALUES (?, ?, ?, 'running', '{}')`,
        ["job-delete-1", key, lane],
      );
      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, 'running', 1)`,
        ["run-delete-1", "job-delete-1", key, lane],
      );
      await db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, 0, 'running', '{}')`,
        ["step-delete-1", "run-delete-1"],
      );

      await db.run(
        `INSERT INTO channel_inbox (
           source,
           thread_id,
           message_id,
           key,
           lane,
           received_at_ms,
           payload_json,
           status
         ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'queued')`,
        ["ui", "thread-1", "msg-delete-queued", key, lane, 1_000],
      );

      const cm = new ConnectionManager();
      const { id } = makeClient(cm, ["cli"]);
      const client = cm.getClient(id)!;
      const deps = makeDeps(cm, { db });

      const result = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-session-delete-1",
          type: "session.delete",
          payload: { session_id: "ui:thread-1" },
        }),
        deps,
      );

      expect(result).toBeDefined();
      expect((result as unknown as { ok: boolean }).ok).toBe(true);
      expect((result as unknown as { type: string }).type).toBe("session.delete");

      const session = await db.get<{ session_id: string }>(
        `SELECT session_id
         FROM sessions
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(session).toBeUndefined();

      const modelOverride = await db.get<{ model_id: string }>(
        `SELECT model_id
         FROM session_model_overrides
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(modelOverride).toBeUndefined();

      const pin = await db.get<{ profile_id: string }>(
        `SELECT profile_id
         FROM session_provider_pins
         WHERE agent_id = ? AND session_id = ?`,
        ["default", "ui:thread-1"],
      );
      expect(pin).toBeUndefined();

      const queueOverride = await db.get<{ queue_mode: string }>(
        `SELECT queue_mode
         FROM lane_queue_mode_overrides
         WHERE key = ? AND lane = ?`,
        [key, lane],
      );
      expect(queueOverride).toBeUndefined();

      const sendOverride = await db.get<{ send_policy: string }>(
        `SELECT send_policy
         FROM session_send_policy_overrides
         WHERE key = ?`,
        [key],
      );
      expect(sendOverride).toBeUndefined();

      const run = await db.get<{ status: string }>(
        `SELECT status
         FROM execution_runs
         WHERE run_id = ?`,
        ["run-delete-1"],
      );
      expect(run?.status).toBe("cancelled");

      const queued = await db.get<{ status: string; error: string | null }>(
        `SELECT status, error
         FROM channel_inbox
         WHERE message_id = ?`,
        ["msg-delete-queued"],
      );
      expect(queued?.status).toBe("failed");
      expect(queued?.error).toContain("delete");
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// dispatchTask
// ---------------------------------------------------------------------------

describe("dispatchTask", () => {
  it("sends task.execute request to a capable client", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"], { protocolRev: 2 });
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: { url: "https://example.com" },
    };

    const taskId = await dispatchTask(
      action,
      {
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
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
         VALUES (?, ?, ?, ?, ?)`,
        ["job-1", "agent:default", "default", "running", "{}"],
      );
      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["550e8400-e29b-41d4-a716-446655440000", "job-1", "agent:default", "default", "running", 1],
      );
      await db.run(
        `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          "550e8400-e29b-41d4-a716-446655440000",
          0,
          "running",
          JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
        ],
      );
      await db.run(
        `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status)
         VALUES (?, ?, ?, ?)`,
        [
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableClientError);
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
            role: "client",
            protocol_rev: 1,
            device_id: "dev-1",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: ["cli"],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
          {
            connection_id: "conn-v2",
            edge_id: "edge-a",
            role: "client",
            protocol_rev: 2,
            device_id: "dev-2",
            pubkey: null,
            label: null,
            version: null,
            mode: null,
            capabilities: ["cli"],
            connected_at_ms: 0,
            last_seen_at_ms: 0,
            expires_at_ms: 10_000,
          },
        ];
      }),
    };

    const deps = makeDeps(cm, {
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
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );

    expect(outboxDal.enqueue).toHaveBeenCalledOnce();
    const payload = outboxDal.enqueue.mock.calls[0]![1] as {
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableClientError);
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

    const taskId = await dispatchTask(
      action,
      {
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).toHaveBeenCalledOnce();
  });

  it("does not dispatch to a node when its pairing allowlist version excludes the capability", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
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

    const taskId = await dispatchTask(
      action,
      {
        runId: "550e8400-e29b-41d4-a716-446655440000",
        stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).toHaveBeenCalledOnce();
  });

  it("does not dispatch to a node when policy denies node dispatch", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableClientError);
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(NoCapableClientError);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("throws NoCapableClientError when no client has the capability", () => {
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableClientError);
  });

  it("throws NoCapableClientError when no clients are connected", () => {
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
          runId: "550e8400-e29b-41d4-a716-446655440000",
          stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
        deps,
      ),
    ).toThrow(NoCapableClientError);
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
      {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
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
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
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
      {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
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
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      },
    });
    const { ws: operatorWs } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
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
      {
        approval_id: 1,
        plan_id: "plan-1",
        step_index: 0,
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

    sendPlanUpdate("plan-1", "executing", deps, "step 2 of 5");

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

    sendPlanUpdate("plan-1", "completed", deps);

    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(sent["type"]).toBe("plan.update");
    expect((sent["payload"] as Record<string, unknown>)["plan_id"]).toBe("plan-1");
    expect((sent["payload"] as Record<string, unknown>)["status"]).toBe("completed");
  });
});
