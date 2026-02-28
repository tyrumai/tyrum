import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngineArtifactRecorder } from "../../src/modules/execution/engine/artifact-recorder.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ExecutionEngineArtifactRecorder", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("records artifacts and emits created/attached events", async () => {
    db = openTestSqliteDb();

    const jobId = "job-artifacts-1";
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const stepId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    const attemptId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, "agent:agent-1", "main", "running", "{}"],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [runId, jobId, "agent:agent-1", "main", "running", 1],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, ?, ?, ?)`,
      [stepId, runId, 0, "running", JSON.stringify({ type: "Research", args: {} })],
    );
    await db.run(
      `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status)
       VALUES (?, ?, ?, ?)`,
      [attemptId, stepId, 1, "running"],
    );

    await db.run("DELETE FROM outbox");

    const nowIso = new Date(0).toISOString();
    const eventEmitter = new ExecutionEngineEventEmitter({
      clock: () => ({ nowMs: 0, nowIso }),
      eventsEnabled: true,
    });
    const recorder = new ExecutionEngineArtifactRecorder({
      eventEmitter,
      redactUnknown: (value) => value,
    });

    const artifact = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440111",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440111",
      kind: "log",
      created_at: nowIso,
      labels: ["label-1"],
      metadata: { ok: true },
    } as const;

    await db.transaction(async (tx) => {
      await recorder.recordArtifactsTx(
        tx,
        { runId, stepId, attemptId, workspaceId: "default", key: "agent:agent-1" },
        [artifact],
      );
    });

    const row = await db.get<{ artifact_id: string; uri: string }>(
      "SELECT artifact_id, uri FROM execution_artifacts WHERE artifact_id = ?",
      [artifact.artifact_id],
    );
    expect(row?.artifact_id).toBe(artifact.artifact_id);
    expect(row?.uri).toBe(artifact.uri);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((r) => JSON.parse(r.payload_json) as { message?: { type?: string } })
      .map((r) => r.message?.type)
      .filter((t): t is string => typeof t === "string");
    expect(types).toContain("artifact.created");
    expect(types).toContain("artifact.attached");
  });
});

