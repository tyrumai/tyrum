import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ExecutionEngineEventEmitter", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("emits run.updated for an existing run", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });

    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-emitter-1",
      requestId: "req-emitter-1",
      steps: [{ type: "Research", args: {} }],
    });

    await db.run("DELETE FROM outbox");

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
});
