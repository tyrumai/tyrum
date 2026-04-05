import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import {
  persistExecutionArtifactBytes,
  resolveExecutionArtifactScope,
} from "../../src/modules/artifact/execution-artifacts.js";
import type { ArtifactStore } from "../../src/modules/artifact/store.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const JOB_ID = "job-execution-artifacts-1";
const TURN_ID = "turn-execution-artifacts-1";
const MISSING_STEP_ID = "missing-execution-step";
const ARTIFACT_ID = "550e8400-e29b-41d4-a716-446655440222";

async function seedExecutionRunScope(db: SqliteDb): Promise<void> {
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id
     )
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      JOB_ID,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:default:test:default:channel:thread-1",
      "{}",
      "{}",
      TURN_ID,
    ],
  );

  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, 'running', 1)`,
    [DEFAULT_TENANT_ID, TURN_ID, JOB_ID, "agent:default:test:default:channel:thread-1"],
  );
}

function createArtifactRef(): ArtifactRefT {
  return {
    artifact_id: ARTIFACT_ID,
    uri: `artifact://${ARTIFACT_ID}`,
    external_url: `https://gateway.example.test/a/${ARTIFACT_ID}`,
    kind: "log",
    media_class: "document",
    created_at: new Date(0).toISOString(),
    filename: "artifact.log",
    mime_type: "text/plain",
    size_bytes: 5,
    sha256: "a".repeat(64),
    labels: [],
    metadata: { ok: true },
  };
}

function createArtifactStore(artifact: ArtifactRefT): {
  artifactStore: ArtifactStore;
  put: ReturnType<typeof vi.fn>;
} {
  const put = vi.fn(async () => artifact);
  return {
    artifactStore: {
      put,
      get: async () => null,
      delete: async () => {},
    },
    put,
  };
}

describe("execution artifact scope resolution", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("keeps the execution run scope when the step cannot resolve a workflow run step", async () => {
    db = openTestSqliteDb();
    await seedExecutionRunScope(db);

    const resolved = await resolveExecutionArtifactScope(db, {
      turnId: TURN_ID,
      stepId: MISSING_STEP_ID,
    });

    expect(resolved).toEqual({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      agentId: DEFAULT_AGENT_ID,
      policySnapshotId: null,
      workflowRunStepId: null,
    });
  });

  it("uses the explicit fallback scope when the execution run scope is missing", async () => {
    db = openTestSqliteDb();
    const artifact = createArtifactRef();
    const { artifactStore, put } = createArtifactStore(artifact);

    const stored = await persistExecutionArtifactBytes(db, artifactStore, {
      turnId: "missing-turn",
      kind: "log",
      body: Buffer.from("hello", "utf8"),
      sensitivity: "normal",
      fallbackScope: {
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: DEFAULT_AGENT_ID,
        policySnapshotId: null,
      },
    });

    expect(stored).toEqual(artifact);
    expect(put).toHaveBeenCalledOnce();

    const row = await db.get<{ tenant_id: string; workspace_id: string; agent_id: string | null }>(
      "SELECT tenant_id, workspace_id, agent_id FROM artifacts WHERE artifact_id = ?",
      [artifact.artifact_id],
    );
    expect(row).toEqual({
      tenant_id: DEFAULT_TENANT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
      agent_id: DEFAULT_AGENT_ID,
    });

    const links = await db.all<{ parent_kind: string; parent_id: string }>(
      `SELECT parent_kind, parent_id
         FROM artifact_links
         WHERE tenant_id = ? AND artifact_id = ?`,
      [DEFAULT_TENANT_ID, artifact.artifact_id],
    );
    expect(links).toEqual([]);

    const outbox = await db.all("SELECT 1 FROM outbox WHERE topic = ?", ["ws.broadcast"]);
    expect(outbox).toEqual([]);
  });
});
