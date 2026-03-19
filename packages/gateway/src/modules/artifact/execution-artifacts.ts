import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactKind } from "@tyrum/contracts";
import type { ArtifactStore } from "./store.js";
import type { WsEventEnvelope as WsEventEnvelopeT } from "@tyrum/contracts";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import { insertArtifactRecordTx, linkArtifactTx } from "./dal.js";

export type ExecutionArtifactSensitivity = "normal" | "sensitive";

export type ResolvedExecutionArtifactScope = {
  tenantId: string;
  workspaceId: string;
  agentId: string | null;
  policySnapshotId: string | null;
  attemptId: string | null;
};

export type ExecutionArtifactFallbackScope = {
  tenantId: string;
  workspaceId: string;
  agentId: string | null;
  policySnapshotId?: string | null;
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
  const run = await db.get<{
    tenant_id: string;
    job_id: string;
    policy_snapshot_id: string | null;
  }>(
    `SELECT tenant_id, job_id, policy_snapshot_id
     FROM execution_runs
     WHERE run_id = ?`,
    [ids.runId],
  );
  if (!run) return null;

  const step = await db.get<{ tenant_id: string; run_id: string }>(
    `SELECT tenant_id, run_id
     FROM execution_steps
     WHERE step_id = ?`,
    [ids.stepId],
  );
  if (!step) return null;
  if (step.tenant_id !== run.tenant_id) return null;
  if (step.run_id !== ids.runId) return null;

  const job = await db.get<{ agent_id: string; workspace_id: string }>(
    `SELECT agent_id, workspace_id
     FROM execution_jobs
     WHERE tenant_id = ?
       AND job_id = ?`,
    [run.tenant_id, run.job_id],
  );
  if (!job) return null;

  const attempt = await db.get<{ attempt_id: string }>(
    `SELECT attempt_id
     FROM execution_attempts
     WHERE tenant_id = ?
       AND step_id = ?
     ORDER BY attempt DESC
     LIMIT 1`,
    [run.tenant_id, ids.stepId],
  );

  return {
    tenantId: run.tenant_id,
    workspaceId: ids.workspaceId?.trim() || job.workspace_id,
    agentId: job.agent_id ?? null,
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
      tenantId: string;
      workspaceId: string;
      agentId: string | null;
      runId: string | null;
      stepId: string | null;
      attemptId: string | null;
      sensitivity: ExecutionArtifactSensitivity;
      policySnapshotId: string | null;
    };
  },
): Promise<{ inserted: boolean }> {
  const { inserted } = await insertArtifactRecordTx(tx, {
    artifact: input.artifact,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sensitivity: input.scope.sensitivity,
    policySnapshotId: input.scope.policySnapshotId,
    labelsJson: input.labelsJson,
    metadataJson: input.metadataJson,
  });

  if (input.scope.runId) {
    await linkArtifactTx(tx, {
      tenantId: input.scope.tenantId,
      artifactId: input.artifact.artifact_id,
      parentKind: "execution_run",
      parentId: input.scope.runId,
      createdAt: input.artifact.created_at,
    });
  }
  if (input.scope.stepId) {
    await linkArtifactTx(tx, {
      tenantId: input.scope.tenantId,
      artifactId: input.artifact.artifact_id,
      parentKind: "execution_step",
      parentId: input.scope.stepId,
      createdAt: input.artifact.created_at,
    });
  }
  if (input.scope.attemptId) {
    await linkArtifactTx(tx, {
      tenantId: input.scope.tenantId,
      artifactId: input.artifact.artifact_id,
      parentKind: "execution_attempt",
      parentId: input.scope.attemptId,
      createdAt: input.artifact.created_at,
    });
  }

  return { inserted };
}

export async function emitArtifactCreatedTx(
  tx: SqlDb,
  tenantId: string,
  runId: string,
  artifact: ArtifactRefT,
) {
  const evt: WsEventEnvelopeT = {
    event_id: randomUUID(),
    type: "artifact.created",
    occurred_at: new Date().toISOString(),
    scope: { kind: "run", run_id: runId },
    payload: { artifact },
  };
  await enqueueWsBroadcastMessage(tx, tenantId, evt);
}

export async function emitArtifactAttachedTx(
  tx: SqlDb,
  tenantId: string,
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
  await enqueueWsBroadcastMessage(tx, tenantId, evt);
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
    fallbackScope?: ExecutionArtifactFallbackScope;
  },
): Promise<ArtifactRefT | null> {
  const resolved = await resolveExecutionArtifactScope(db, {
    runId: input.runId,
    stepId: input.stepId,
    workspaceId: input.workspaceId,
  });
  const fallback = input.fallbackScope;
  if (!resolved && !fallback) return null;

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
        tenantId: resolved?.tenantId ?? fallback!.tenantId,
        workspaceId: resolved?.workspaceId ?? fallback!.workspaceId,
        agentId: resolved?.agentId ?? fallback!.agentId,
        runId: resolved ? input.runId : null,
        stepId: resolved ? input.stepId : null,
        attemptId: resolved?.attemptId ?? null,
        sensitivity: input.sensitivity,
        policySnapshotId: resolved?.policySnapshotId ?? fallback?.policySnapshotId ?? null,
      },
    });

    if (!resolved) return;

    if (inserted) {
      await emitArtifactCreatedTx(tx, resolved.tenantId, input.runId, artifact);
    }
    if (resolved.attemptId) {
      await emitArtifactAttachedTx(
        tx,
        resolved.tenantId,
        input.runId,
        input.stepId,
        resolved.attemptId,
        artifact,
      );
    }
  });

  return artifact;
}
