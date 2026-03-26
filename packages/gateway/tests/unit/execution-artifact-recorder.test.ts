import { afterEach, describe, expect, it } from "vitest";
import { ExecutionEngineArtifactRecorder } from "../../src/modules/execution/engine/artifact-recorder.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ExecutionEngineArtifactRecorder", () => {
  let db: SqliteDb | undefined;

  async function setup(): Promise<{
    recorder: ExecutionEngineArtifactRecorder;
    scope: {
      tenantId: string;
      runId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      agentId: string;
    };
    artifact: {
      artifact_id: string;
      uri: string;
      kind: "log";
      created_at: string;
      labels: readonly ["label-1"];
      metadata: { ok: true };
    };
  }> {
    if (!db) throw new Error("test db not initialized");

    const jobId = "job-artifacts-1";
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const stepId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    const attemptId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    await db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         lane,
         status,
         trigger_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        null,
        "agent:agent-1",
        "main",
        "running",
        "{}",
        runId,
      ],
    );
    await db.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, runId, jobId, "agent:agent-1", "main", "running", 1],
    );
    await db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        stepId,
        runId,
        0,
        "running",
        JSON.stringify({ type: "Research", args: {} }),
      ],
    );
    await db.run(
      `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, attemptId, stepId, 1, "running"],
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
      external_url: "https://gateway.example.test/a/550e8400-e29b-41d4-a716-446655440111",
      kind: "log",
      media_class: "other",
      created_at: nowIso,
      filename: "artifact-550e8400-e29b-41d4-a716-446655440111.log",
      mime_type: "text/plain",
      size_bytes: 7,
      sha256: "a".repeat(64),
      labels: ["label-1"],
      metadata: { ok: true },
    } as const;

    return {
      recorder,
      scope: {
        tenantId: DEFAULT_TENANT_ID,
        runId,
        stepId,
        attemptId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: DEFAULT_AGENT_ID,
      },
      artifact,
    };
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("records artifacts and emits created/attached events", async () => {
    db = openTestSqliteDb();
    const { recorder, scope, artifact } = await setup();

    await db.transaction(async (tx) => {
      await recorder.recordArtifactsTx(tx, scope, [artifact]);
    });

    const row = await db.get<{ artifact_id: string; uri: string }>(
      "SELECT artifact_id, uri FROM artifacts WHERE tenant_id = ? AND artifact_id = ?",
      [DEFAULT_TENANT_ID, artifact.artifact_id],
    );
    expect(row?.artifact_id).toBe(artifact.artifact_id);
    expect(row?.uri).toBe(artifact.uri);

    const links = await db.all<{ parent_kind: string; parent_id: string }>(
      `SELECT parent_kind, parent_id
       FROM artifact_links
       WHERE tenant_id = ? AND artifact_id = ?
       ORDER BY parent_kind, parent_id`,
      [DEFAULT_TENANT_ID, artifact.artifact_id],
    );
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent_kind: "execution_run", parent_id: scope.runId }),
        expect.objectContaining({ parent_kind: "execution_step", parent_id: scope.stepId }),
        expect.objectContaining({ parent_kind: "execution_attempt", parent_id: scope.attemptId }),
      ]),
    );

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

  it("only emits artifact.created for the first insert", async () => {
    db = openTestSqliteDb();
    const { recorder, scope, artifact } = await setup();

    await db.transaction(async (tx) => {
      await recorder.recordArtifactsTx(tx, scope, [artifact]);
      await recorder.recordArtifactsTx(tx, scope, [artifact]);
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((r) => JSON.parse(r.payload_json) as { message?: { type?: string } })
      .map((r) => r.message?.type)
      .filter((t): t is string => typeof t === "string");
    expect(types.filter((t) => t === "artifact.created")).toHaveLength(1);
    expect(types.filter((t) => t === "artifact.attached")).toHaveLength(2);
  });
});
