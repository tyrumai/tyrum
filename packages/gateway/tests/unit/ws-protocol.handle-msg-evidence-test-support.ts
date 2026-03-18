import { expect, it, vi } from "vitest";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { createSpyLogger, makeDeps, makeClient } from "./ws-protocol.test-support.js";

/**
 * Capability.ready and attempt.evidence tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerCapabilityReadyTests(): void {
  it("accepts capability.ready from nodes and broadcasts a capability.ready event", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["desktop"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
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
              id: descriptorIdForClientCapability("playwright"),
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
    const { id: nodeConnId } = makeClient(cm, ["desktop"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    makeClient(cm, ["desktop"], { protocolRev: 2 });
    const node = cm.getClient(nodeConnId)!;

    const logger = createSpyLogger();
    const setReadyCapabilities = vi.fn(async () => {
      throw new Error("persist failed");
    });
    const setCapabilityStates = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined as never);

    const deps = makeDeps(cm, {
      logger,
      cluster: {
        edgeId: "edge-1",
        outboxDal: { enqueue } as never,
        connectionDirectory: { setReadyCapabilities, setCapabilityStates } as never,
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
              id: descriptorIdForClientCapability("playwright"),
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
}

function registerAttemptEvidenceTests(): void {
  it("logs attempt.evidence node pairing lookup failures", async () => {
    const cm = new ConnectionManager();
    const { id: nodeConnId } = makeClient(cm, ["desktop"], {
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
      const { id: nodeConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
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
          JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
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
    const { id: nodeConnId } = makeClient(cm, ["desktop"], {
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
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
      const { id: executorConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_executor",
        protocolRev: 2,
      });
      const { id: attackerConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_attacker",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });

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
          JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
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
}

export function registerHandleMessageEvidenceTests(): void {
  registerCapabilityReadyTests();
  registerAttemptEvidenceTests();
}
