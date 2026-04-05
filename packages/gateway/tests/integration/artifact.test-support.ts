import type { ArtifactRef } from "@tyrum/contracts";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  createTestAuthAndSecrets,
  createTestContainer,
  decorateAppWithDefaultAuth,
} from "./helpers.js";

const TEST_PUBLIC_BASE_URL = "https://gateway.example.test";

type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

export type ExecutionScopeIds = {
  jobId: string;
  turnId: string;
  stepId: string;
  attemptId: string;
  workflowRunStepId?: string;
};

type ExecutionArtifactRecord = {
  artifactId: string;
  kind: ArtifactRef["kind"];
  uri: string;
  createdAt: string;
  mediaClass?: ArtifactRef["media_class"];
  filename?: string;
  mimeType?: string;
  externalUrl?: string;
  sizeBytes?: number;
  sha256?: string;
  labels?: string[];
  metadata?: unknown;
  workspaceId?: string | null;
  agentId?: string | null;
  turnId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
  workflowRunStepId?: string | null;
  dispatchId?: string | null;
  policySnapshotId?: string | null;
};

const EXECUTION_KEY = "agent:agent-1:thread:thread-1";
const INSERT_ARTIFACT_SQL = `INSERT INTO artifacts (
  tenant_id,
  artifact_id,
  access_id,
  workspace_id,
  agent_id,
  kind,
  uri,
  external_url,
  media_class,
  filename,
  created_at,
  mime_type,
  size_bytes,
  sha256,
  labels_json,
  metadata_json,
  sensitivity,
  policy_snapshot_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_ARTIFACT_ACCESS_SQL = `INSERT INTO artifact_access (
  access_id,
  tenant_id,
  artifact_id,
  created_at
)
VALUES (?, ?, ?, ?)
ON CONFLICT (tenant_id, artifact_id) DO NOTHING`;

const INSERT_ARTIFACT_LINK_SQL = `INSERT INTO artifact_links (
  tenant_id,
  artifact_id,
  parent_kind,
  parent_id,
  created_at
)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (tenant_id, artifact_id, parent_kind, parent_id) DO NOTHING`;

function withDefault<T>(value: T | null | undefined, fallback: T): T | null {
  if (value === undefined) return fallback;
  return value;
}

export async function seedExecutionScope(db: SqlRunner, ids: ExecutionScopeIds): Promise<void> {
  const workflowRunStepId = ids.workflowRunStepId ?? ids.stepId;

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
      ids.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      EXECUTION_KEY,
      "{}",
      "{}",
      ids.turnId,
    ],
  );

  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, 'running', 1)`,
    [DEFAULT_TENANT_ID, ids.turnId, ids.jobId, EXECUTION_KEY],
  );

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
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    [ids.turnId, DEFAULT_TENANT_ID, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, EXECUTION_KEY, "{}"],
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
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [DEFAULT_TENANT_ID, workflowRunStepId, ids.turnId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [DEFAULT_TENANT_ID, ids.stepId, ids.turnId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, ?, 1, 'running', '[]')`,
    [DEFAULT_TENANT_ID, ids.attemptId, ids.stepId],
  );
}

export async function insertExecutionArtifactRecord(
  db: SqlRunner,
  record: ExecutionArtifactRecord,
): Promise<void> {
  const externalUrl = record.externalUrl ?? `${TEST_PUBLIC_BASE_URL}/a/${record.artifactId}`;

  await db.run(INSERT_ARTIFACT_SQL, [
    DEFAULT_TENANT_ID,
    record.artifactId,
    record.artifactId,
    withDefault(record.workspaceId, DEFAULT_WORKSPACE_ID),
    withDefault(record.agentId, DEFAULT_AGENT_ID),
    record.kind,
    record.uri,
    externalUrl,
    record.mediaClass ?? "other",
    record.filename ?? `${record.artifactId}.bin`,
    record.createdAt,
    record.mimeType ?? null,
    record.sizeBytes ?? null,
    record.sha256 ?? null,
    JSON.stringify(record.labels ?? []),
    JSON.stringify(record.metadata ?? {}),
    "normal",
    withDefault(record.policySnapshotId, null),
  ]);

  await db.run(INSERT_ARTIFACT_ACCESS_SQL, [
    record.artifactId,
    DEFAULT_TENANT_ID,
    record.artifactId,
    record.createdAt,
  ]);
}

export async function linkArtifactToExecution(
  db: SqlRunner,
  ref: ArtifactRef,
  scope: Omit<ExecutionArtifactRecord, "artifactId" | "kind" | "createdAt"> & {
    uri?: string;
  },
): Promise<void> {
  await insertExecutionArtifactRecord(db, {
    artifactId: ref.artifact_id,
    kind: ref.kind,
    uri: scope.uri ?? ref.uri,
    createdAt: ref.created_at,
    mediaClass: ref.media_class,
    filename: ref.filename,
    mimeType: ref.mime_type,
    externalUrl: ref.external_url,
    sizeBytes: ref.size_bytes,
    sha256: ref.sha256,
    labels: ref.labels,
    metadata: ref.metadata,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    turnId: scope.turnId,
    stepId: scope.stepId,
    attemptId: scope.attemptId,
    workflowRunStepId: scope.workflowRunStepId,
    dispatchId: scope.dispatchId,
    policySnapshotId: scope.policySnapshotId,
  });

  if (scope.turnId) {
    await db.run(INSERT_ARTIFACT_LINK_SQL, [
      DEFAULT_TENANT_ID,
      ref.artifact_id,
      "execution_run",
      scope.turnId,
      ref.created_at,
    ]);
  }
  const workflowRunStepId = scope.workflowRunStepId ?? scope.stepId;
  if (workflowRunStepId) {
    await db.run(INSERT_ARTIFACT_LINK_SQL, [
      DEFAULT_TENANT_ID,
      ref.artifact_id,
      "workflow_run_step",
      workflowRunStepId,
      ref.created_at,
    ]);
  }
  if (scope.dispatchId) {
    await db.run(INSERT_ARTIFACT_LINK_SQL, [
      DEFAULT_TENANT_ID,
      ref.artifact_id,
      "dispatch_record",
      scope.dispatchId,
      ref.created_at,
    ]);
  }
}

export async function putTextArtifact(
  container: Pick<GatewayContainer, "artifactStore">,
): Promise<ArtifactRef> {
  return await container.artifactStore.put({
    kind: "log",
    mime_type: "text/plain",
    body: Buffer.from("hello", "utf8"),
    labels: ["log"],
    metadata: { test: true },
  });
}

export async function setupArtifactRouteTest(
  homeDir: string | undefined,
  container?: GatewayContainer,
) {
  const resolvedContainer =
    container ??
    (await createTestContainer({
      tyrumHome: homeDir,
      deploymentConfig: {
        server: {
          publicBaseUrl: TEST_PUBLIC_BASE_URL,
        },
      },
    }));
  const { authTokens, tenantAdminToken, secretProviderForTenant } = await createTestAuthAndSecrets(
    resolvedContainer,
    { tyrumHome: homeDir },
  );
  const app = createApp(resolvedContainer, { authTokens, secretProviderForTenant });
  const { requestUnauthenticated } = decorateAppWithDefaultAuth(app, tenantAdminToken);

  return {
    app,
    container: resolvedContainer,
    tenantAdminToken,
    requestUnauthenticated,
  };
}
