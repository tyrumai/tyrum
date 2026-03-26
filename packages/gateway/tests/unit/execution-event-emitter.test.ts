import { WsEvent } from "@tyrum/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { emitArtifactAttachedTx as emitStandaloneArtifactAttachedTx } from "../../src/modules/artifact/execution-artifacts.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("ExecutionEngineEventEmitter", () => {
  let db: SqliteDb | undefined;

  async function createRun(): Promise<{ runId: string; nowIso: string }> {
    if (!db) throw new Error("test db not initialized");

    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-emitter-1",
      requestId: "req-emitter-1",
      steps: [{ type: "Research", args: {} }],
    });

    await db.run("DELETE FROM outbox");

    return { runId, nowIso };
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("emits turn.updated for an existing run", async () => {
    db = openTestSqliteDb();
    const { runId, nowIso } = await createRun();

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });

    await db.transaction(async (tx) => {
      await emitter.emitRunUpdatedTx(tx, runId);
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

  it("emits artifact.attached events that satisfy the published schema", async () => {
    db = openTestSqliteDb();
    const { runId, nowIso } = await createRun();
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
    const step = await db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE turn_id = ? LIMIT 1",
      [runId],
    );
    const attemptId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    await db.run(
      "INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status) VALUES (?, ?, ?, ?, ?)",
      [DEFAULT_TENANT_ID, attemptId, step!.step_id, 1, "running"],
    );

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });

    await db.transaction(async (tx) => {
      await emitter.emitArtifactAttachedTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        runId,
        stepId: step!.step_id,
        attemptId,
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
      expect(parsed.data.payload.turn_id).toBe(runId);
    }
  });

  it("emits standalone artifact.attached events that satisfy the published schema", async () => {
    db = openTestSqliteDb();
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const stepId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    const attemptId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
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
      await emitStandaloneArtifactAttachedTx(
        tx,
        DEFAULT_TENANT_ID,
        runId,
        stepId,
        attemptId,
        artifact,
      );
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
      expect(parsed.data.payload.turn_id).toBe(runId);
    }
  });

  it("does not enqueue events when eventsEnabled is false", async () => {
    db = openTestSqliteDb();
    const { runId, nowIso } = await createRun();

    const emitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: false,
    });

    await db.transaction(async (tx) => {
      await emitter.emitRunUpdatedTx(tx, runId);
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    expect(outbox).toHaveLength(0);
  });
});
