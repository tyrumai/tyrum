import { expect, it, vi } from "vitest";
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
 * Pairing, scopes, presence, and ping scope tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerPairingAndCommandScopeTests(): void {
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
}

function registerPresenceAndPingScopeTests(): void {
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
}

export function registerHandleMessageScopeTests(): void {
  registerPairingAndCommandScopeTests();
  registerPresenceAndPingScopeTests();
}
