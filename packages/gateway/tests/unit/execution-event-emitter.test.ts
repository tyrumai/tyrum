import { WsEvent, buildAgentConversationKey } from "@tyrum/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { emitArtifactAttachedTx as emitStandaloneArtifactAttachedTx } from "../../src/modules/artifact/execution-artifacts.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("ExecutionEngineEventEmitter", () => {
  let db: SqliteDb | undefined;

  async function createRun(): Promise<{ turnId: string; nowIso: string }> {
    if (!db) throw new Error("test db not initialized");

    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });

    const { turnId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-emitter-1",
      requestId: "req-emitter-1",
      steps: [{ type: "Research", args: {} }],
    });

    await db.run("DELETE FROM outbox");

    return { turnId, nowIso };
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("emits turn.updated for an existing run", async () => {
    db = openTestSqliteDb();
    const { turnId, nowIso } = await createRun();

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });

    await db.transaction(async (tx) => {
      await emitter.emitTurnUpdatedTx(tx, turnId);
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types).toContain("turn.updated");
  });

  it("includes trigger_kind in turn.updated payloads when the job trigger is known", async () => {
    db = openTestSqliteDb();
    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });
    const heartbeatKey = buildAgentConversationKey({
      agentKey: "default",
      channel: "automation",
      account: "default",
      container: "channel",
      id: "heartbeat",
    });

    const { turnId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: heartbeatKey,
      planId: "plan-emitter-heartbeat-1",
      requestId: "req-emitter-heartbeat-1",
      steps: [{ type: "Research", args: {} }],
      trigger: {
        kind: "heartbeat",
        conversation_key: heartbeatKey,
      },
    });

    await db.run("DELETE FROM outbox");

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });

    await db.transaction(async (tx) => {
      await emitter.emitTurnUpdatedTx(tx, turnId);
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const envelope = JSON.parse(outbox[0]!.payload_json) as { message: unknown };
    const parsed = WsEvent.safeParse(envelope.message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("turn.updated");
      expect(parsed.data.payload.trigger_kind).toBe("heartbeat");
    }
  });

  it("emits artifact.attached events that satisfy the published schema", async () => {
    db = openTestSqliteDb();
    const { turnId, nowIso } = await createRun();
    const artifact = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440111",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440111",
      external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440111",
      kind: "log",
      media_class: "document",
      created_at: nowIso,
      filename: "artifact.log",
      labels: [],
    } as const;
    await db.run(
      `INSERT INTO workflow_runs (
         workflow_run_id,
         tenant_id,
         agent_id,
         workspace_id,
         run_key,
         status,
         trigger_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        turnId,
        DEFAULT_TENANT_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "agent:agent-1:telegram-1:group:thread-1",
        "running",
        "{}",
      ],
    );
    await db.run(
      `INSERT INTO workflow_run_steps (
         tenant_id,
         workflow_run_step_id,
         workflow_run_id,
         step_index,
         status,
         action_json
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "6f9619ff-8b86-4d11-b42d-00c04fc964ff", turnId, 0, "running", "{}"],
    );

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });

    await db.transaction(async (tx) => {
      await emitter.emitArtifactAttachedTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        turnId,
        workflowRunStepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        artifact,
      });
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const envelope = JSON.parse(outbox[0]!.payload_json) as { message: unknown };
    const parsed = WsEvent.safeParse(envelope.message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("artifact.attached");
      expect(parsed.data.payload.turn_id).toBe(turnId);
      expect(parsed.data.payload.workflow_run_step_id).toBe("6f9619ff-8b86-4d11-b42d-00c04fc964ff");
    }
  });

  it("emits standalone artifact.attached events that satisfy the published schema", async () => {
    db = openTestSqliteDb();
    const turnId = "550e8400-e29b-41d4-a716-446655440000";
    const artifact = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440112",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440112",
      external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440112",
      kind: "log",
      media_class: "document",
      created_at: new Date(0).toISOString(),
      filename: "artifact.log",
      labels: [],
    } as const;

    await db.transaction(async (tx) => {
      await emitStandaloneArtifactAttachedTx(tx, DEFAULT_TENANT_ID, {
        turnId,
        dispatchId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        artifact,
      });
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const envelope = JSON.parse(outbox[0]!.payload_json) as { message: unknown };
    const parsed = WsEvent.safeParse(envelope.message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("artifact.attached");
      expect(parsed.data.payload.turn_id).toBe(turnId);
      expect(parsed.data.payload.dispatch_id).toBe("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e");
    }
  });

  it("does not enqueue events when eventsEnabled is false", async () => {
    db = openTestSqliteDb();
    const { turnId, nowIso } = await createRun();

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: false,
    });

    await db.transaction(async (tx) => {
      await emitter.emitTurnUpdatedTx(tx, turnId);
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    expect(outbox).toHaveLength(0);
  });
});
