import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { shapeBrowserEvidenceForArtifacts } from "../../src/modules/browser/shape-browser-evidence.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

const PUBLIC_BASE_URL = "https://gateway.example.test";

async function seedExecutionScope(
  db: { run(sql: string, params?: unknown[]): Promise<unknown> },
  ids: ExecutionScopeIds,
): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      ids.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:default:test:default:channel:thread-1",
      "main",
      "{}",
      "{}",
      ids.runId,
    ],
  );

  await db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'running', 1)`,
    [
      DEFAULT_TENANT_ID,
      ids.runId,
      ids.jobId,
      "agent:default:test:default:channel:thread-1",
      "main",
    ],
  );

  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [DEFAULT_TENANT_ID, ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, ?, 1, 'running', '[]')`,
    [DEFAULT_TENANT_ID, ids.attemptId, ids.stepId],
  );
}

describe("shapeBrowserEvidenceForArtifacts", () => {
  const scope: ExecutionScopeIds = {
    jobId: "job-browser-evidence-1",
    runId: "run-browser-evidence-1",
    stepId: "step-browser-evidence-1",
    attemptId: "attempt-browser-evidence-1",
  };

  let db: SqliteDb;
  let didOpenDb = false;
  let artifactsDir = "";
  let artifactStore = new FsArtifactStore(".", undefined, PUBLIC_BASE_URL);

  beforeEach(async () => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    artifactsDir = await mkdtemp(join(tmpdir(), "tyrum-browser-evidence-"));
    artifactStore = new FsArtifactStore(artifactsDir, undefined, PUBLIC_BASE_URL);
    await seedExecutionScope(db, scope);
  });

  afterEach(async () => {
    if (didOpenDb) {
      didOpenDb = false;
      await db.close();
    }
    if (artifactsDir) {
      await rm(artifactsDir, { recursive: true, force: true });
      artifactsDir = "";
    }
  });

  it("stores browser media bytes as an execution artifact and strips bytesBase64 from evidence", async () => {
    const evidence = {
      op: "capture_photo",
      bytesBase64: Buffer.from("hello", "utf8").toString("base64"),
      mime: "image/jpeg",
      timestamp: new Date("2026-02-19T12:00:00Z").toISOString(),
      width: 320,
      height: 240,
    };

    const shaped = await shapeBrowserEvidenceForArtifacts({
      db,
      artifactStore,
      runId: scope.runId,
      stepId: scope.stepId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      evidence,
      sensitivity: "sensitive",
    });

    expect(shaped.artifacts).toHaveLength(1);
    expect(shaped.evidence).toBeTypeOf("object");

    const shapedEvidence = shaped.evidence as Record<string, unknown>;
    expect(shapedEvidence["bytesBase64"]).toBeUndefined();
    expect(shapedEvidence["artifact"]).toBeTypeOf("object");

    const artifact = shapedEvidence["artifact"] as { artifact_id?: string };
    expect(typeof artifact.artifact_id).toBe("string");

    const stored = await artifactStore.get(artifact.artifact_id!);
    expect(stored).not.toBeNull();
    expect(stored?.body.toString("utf8")).toBe("hello");
  });
});
