import type { ArtifactRef as ArtifactRefT } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactKind } from "@tyrum/schemas";
import type { ArtifactStore } from "./store.js";
import type { WsEventEnvelope as WsEventEnvelopeT } from "@tyrum/schemas";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";

export type ExecutionArtifactSensitivity = "normal" | "sensitive";

export type ResolvedExecutionArtifactScope = {
  workspaceId: string;
  agentId: string | null;
  policySnapshotId: string | null;
  attemptId: string | null;
};

export function deriveAgentIdFromExecutionKey(key: string): string | null {
  if (!key.startsWith("agent:")) return null;
  const parts = key.split(":");
  const agentId = parts.length > 1 ? parts[1] : undefined;
  return agentId && agentId.trim().length > 0 ? agentId : null;
}

export async function resolveExecutionArtifactScope(
  db: SqlDb,
  ids: { runId: string; stepId: string; workspaceId?: string },
): Promise<ResolvedExecutionArtifactScope | null> {
  const run = await db.get<{ key: string; policy_snapshot_id: string | null }>(
    `SELECT key, policy_snapshot_id
     FROM execution_runs
     WHERE run_id = ?`,
    [ids.runId],
  );
  if (!run) return null;

  const step = await db.get<{ run_id: string }>(
    `SELECT run_id
     FROM execution_steps
     WHERE step_id = ?`,
    [ids.stepId],
  );
  if (!step) return null;
  if (step.run_id !== ids.runId) return null;

  const attempt = await db.get<{ attempt_id: string }>(
    `SELECT attempt_id
     FROM execution_attempts
     WHERE step_id = ?
     ORDER BY attempt DESC
     LIMIT 1`,
    [ids.stepId],
  );

  return {
    workspaceId: ids.workspaceId?.trim() || "default",
    agentId: deriveAgentIdFromExecutionKey(run.key) ?? null,
    policySnapshotId: run.policy_snapshot_id ?? null,
    attemptId: attempt?.attempt_id ?? null,
  };
}

export async function insertExecutionArtifactRowTx(
  tx: SqlDb,
  input: {
    artifact: ArtifactRefT;
    labelsJson?: string;
    metadataJson?: string;
    scope: {
      workspaceId: string;
      agentId: string | null;
      runId: string;
      stepId: string;
      attemptId: string | null;
      sensitivity: ExecutionArtifactSensitivity;
      policySnapshotId: string | null;
    };
  },
): Promise<{ inserted: boolean }> {
  const labelsJson = input.labelsJson ?? JSON.stringify(input.artifact.labels ?? []);
  const metadataJson = input.metadataJson ?? JSON.stringify(input.artifact.metadata ?? {});

  const insertResult = await tx.run(
    `INSERT INTO execution_artifacts (
       artifact_id,
       workspace_id,
       agent_id,
       run_id,
       step_id,
       attempt_id,
       kind,
       uri,
       created_at,
       mime_type,
       size_bytes,
       sha256,
       labels_json,
       metadata_json,
       sensitivity,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      input.artifact.artifact_id,
      input.scope.workspaceId,
      input.scope.agentId,
      input.scope.runId,
      input.scope.stepId,
      input.scope.attemptId,
      input.artifact.kind,
      input.artifact.uri,
      input.artifact.created_at,
      input.artifact.mime_type ?? null,
      input.artifact.size_bytes ?? null,
      input.artifact.sha256 ?? null,
      labelsJson,
      metadataJson,
      input.scope.sensitivity,
      input.scope.policySnapshotId,
    ],
  );

  return { inserted: insertResult.changes > 0 };
}

export async function emitArtifactCreatedTx(tx: SqlDb, runId: string, artifact: ArtifactRefT) {
  const evt: WsEventEnvelopeT = {
    event_id: randomUUID(),
    type: "artifact.created",
    occurred_at: new Date().toISOString(),
    scope: { kind: "run", run_id: runId },
    payload: { artifact },
  };
  await enqueueWsBroadcastMessage(tx, evt);
}

export async function emitArtifactAttachedTx(
  tx: SqlDb,
  runId: string,
  stepId: string,
  attemptId: string,
  artifact: ArtifactRefT,
) {
  const evt: WsEventEnvelopeT = {
    event_id: randomUUID(),
    type: "artifact.attached",
    occurred_at: new Date().toISOString(),
    scope: { kind: "run", run_id: runId },
    payload: { artifact, step_id: stepId, attempt_id: attemptId },
  };
  await enqueueWsBroadcastMessage(tx, evt);
}

export async function persistExecutionArtifactBytes(
  db: SqlDb,
  artifactStore: ArtifactStore,
  input: {
    runId: string;
    stepId: string;
    workspaceId?: string;
    kind: ArtifactKind;
    body: Buffer;
    mimeType?: string;
    labels?: string[];
    metadata?: unknown;
    sensitivity: ExecutionArtifactSensitivity;
  },
): Promise<ArtifactRefT | null> {
  const scope = await resolveExecutionArtifactScope(db, {
    runId: input.runId,
    stepId: input.stepId,
    workspaceId: input.workspaceId,
  });
  if (!scope) return null;

  const artifact = await artifactStore.put({
    kind: input.kind,
    body: input.body,
    mime_type: input.mimeType,
    labels: input.labels,
    metadata: input.metadata,
  });

  await db.transaction(async (tx) => {
    const { inserted } = await insertExecutionArtifactRowTx(tx, {
      artifact,
      scope: {
        workspaceId: scope.workspaceId,
        agentId: scope.agentId,
        runId: input.runId,
        stepId: input.stepId,
        attemptId: scope.attemptId,
        sensitivity: input.sensitivity,
        policySnapshotId: scope.policySnapshotId,
      },
    });

    if (inserted) {
      await emitArtifactCreatedTx(tx, input.runId, artifact);
    }
    if (scope.attemptId) {
      await emitArtifactAttachedTx(tx, input.runId, input.stepId, scope.attemptId, artifact);
    }
  });

  return artifact;
}
