import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
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

  it("emits run.updated for an existing run", async () => {
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
    expect(types).toContain("run.updated");
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
