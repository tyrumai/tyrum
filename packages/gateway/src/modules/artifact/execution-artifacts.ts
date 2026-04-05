import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactKind } from "@tyrum/contracts";
import type { ArtifactStore } from "./store.js";
import type { WsEventEnvelope as WsEventEnvelopeT } from "@tyrum/contracts";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import { resolveWorkflowRunStepIdForExecutionStep } from "../execution/workflow-run-step-id.js";
import { insertArtifactRecordTx, linkArtifactLineageTx } from "./dal.js";

export type ExecutionArtifactSensitivity = "normal" | "sensitive";

export type ResolvedExecutionArtifactScope = {
  tenantId: string;
  workspaceId: string;
  agentId: string | null;
  policySnapshotId: string | null;
  workflowRunStepId: string | null;
};

type ResolvedExecutionRunArtifactScope = Omit<ResolvedExecutionArtifactScope, "workflowRunStepId">;

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
  ids: { turnId: string; stepId?: string; workspaceId?: string },
): Promise<ResolvedExecutionArtifactScope | null> {
  const run = await resolveExecutionRunArtifactScope(db, ids);
  if (!run) return null;

  return {
    ...run,
    workflowRunStepId: ids.stepId
      ? await resolveWorkflowRunStepIdForExecutionStep({
          db,
          tenantId: run.tenantId,
          turnId: ids.turnId,
          stepId: ids.stepId,
        })
      : null,
  };
}

async function resolveExecutionRunArtifactScope(
  db: SqlDb,
  ids: { turnId: string; workspaceId?: string },
): Promise<ResolvedExecutionRunArtifactScope | null> {
  const run = await db.get<{
    tenant_id: string;
    job_id: string;
    policy_snapshot_id: string | null;
  }>(
    `SELECT tenant_id, job_id, policy_snapshot_id
     FROM turns
     WHERE turn_id = ?`,
    [ids.turnId],
  );
  if (!run) return null;

  const job = await db.get<{ agent_id: string; workspace_id: string }>(
    `SELECT agent_id, workspace_id
     FROM turn_jobs
     WHERE tenant_id = ?
       AND job_id = ?`,
    [run.tenant_id, run.job_id],
  );
  if (!job) return null;

  return {
    tenantId: run.tenant_id,
    workspaceId: ids.workspaceId?.trim() || job.workspace_id,
    agentId: job.agent_id ?? null,
    policySnapshotId: run.policy_snapshot_id ?? null,
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
      turnId: string | null;
      turnItemId: string | null;
      workflowRunStepId: string | null;
      dispatchId: string | null;
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

  await linkArtifactLineageTx(tx, {
    tenantId: input.scope.tenantId,
    artifactId: input.artifact.artifact_id,
    turnId: input.scope.turnId,
    turnItemId: input.scope.turnItemId,
    workflowRunStepId: input.scope.workflowRunStepId,
    dispatchId: input.scope.dispatchId,
    createdAt: input.artifact.created_at,
  });

  return { inserted };
}

export async function emitArtifactCreatedTx(
  tx: SqlDb,
  tenantId: string,
  turnId: string,
  artifact: ArtifactRefT,
) {
  const evt: WsEventEnvelopeT = {
    event_id: randomUUID(),
    type: "artifact.created",
    occurred_at: new Date().toISOString(),
    scope: { kind: "turn", turn_id: turnId },
    payload: { artifact },
  };
  await enqueueWsBroadcastMessage(tx, tenantId, evt);
}

export type ArtifactAttachmentEventScope = {
  turnId: string;
  turnItemId?: string | null;
  workflowRunStepId?: string | null;
  dispatchId?: string | null;
};

export function createArtifactAttachedEvent(input: {
  artifact: ArtifactRefT;
  occurredAt: string;
  scope: ArtifactAttachmentEventScope;
}): WsEventEnvelopeT | null {
  const turnItemId = input.scope.turnItemId?.trim();
  const workflowRunStepId = input.scope.workflowRunStepId?.trim();
  const dispatchId = input.scope.dispatchId?.trim();
  if (!turnItemId && !workflowRunStepId && !dispatchId) {
    return null;
  }

  return {
    event_id: randomUUID(),
    type: "artifact.attached",
    occurred_at: input.occurredAt,
    scope: { kind: "turn", turn_id: input.scope.turnId },
    payload: {
      artifact: input.artifact,
      turn_id: input.scope.turnId,
      ...(turnItemId ? { turn_item_id: turnItemId } : {}),
      ...(workflowRunStepId ? { workflow_run_step_id: workflowRunStepId } : {}),
      ...(dispatchId ? { dispatch_id: dispatchId } : {}),
    },
  };
}

export async function emitArtifactAttachedTx(
  tx: SqlDb,
  tenantId: string,
  input: ArtifactAttachmentEventScope & { artifact: ArtifactRefT },
) {
  const evt = createArtifactAttachedEvent({
    artifact: input.artifact,
    occurredAt: new Date().toISOString(),
    scope: input,
  });
  if (!evt) {
    return;
  }
  await enqueueWsBroadcastMessage(tx, tenantId, evt);
}

async function resolveDispatchArtifactScope(
  db: SqlDb,
  input: { tenantId: string; dispatchId?: string },
): Promise<{
  dispatchId: string;
  turnItemId: string | null;
  workflowRunStepId: string | null;
} | null> {
  const dispatchId = input.dispatchId?.trim();
  if (!dispatchId) {
    return null;
  }

  const row = await db.get<{
    dispatch_id: string;
    turn_item_id: string | null;
    workflow_run_step_id: string | null;
  }>(
    `SELECT dispatch_id, turn_item_id, workflow_run_step_id
       FROM dispatch_records
       WHERE tenant_id = ? AND dispatch_id = ?
       LIMIT 1`,
    [input.tenantId, dispatchId],
  );
  if (!row) {
    return null;
  }

  return {
    dispatchId: row.dispatch_id,
    turnItemId: row.turn_item_id,
    workflowRunStepId: row.workflow_run_step_id,
  };
}

export async function persistExecutionArtifactBytes(
  db: SqlDb,
  artifactStore: ArtifactStore,
  input: {
    turnId: string;
    stepId?: string;
    dispatchId?: string;
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
    turnId: input.turnId,
    stepId: input.stepId,
    workspaceId: input.workspaceId,
  });
  const resolvedRun =
    resolved ??
    (await resolveExecutionRunArtifactScope(db, {
      turnId: input.turnId,
      workspaceId: input.workspaceId,
    }));
  const fallback = input.fallbackScope;
  if (!resolvedRun && !fallback) return null;

  const artifact = await artifactStore.put({
    kind: input.kind,
    body: input.body,
    mime_type: input.mimeType,
    labels: input.labels,
    metadata: input.metadata,
  });

  await db.transaction(async (tx) => {
    const tenantId = resolvedRun?.tenantId ?? fallback!.tenantId;
    const dispatchScope = await resolveDispatchArtifactScope(tx, {
      tenantId,
      dispatchId: input.dispatchId,
    });
    const { inserted } = await insertExecutionArtifactRowTx(tx, {
      artifact,
      scope: {
        tenantId,
        workspaceId: resolvedRun?.workspaceId ?? fallback!.workspaceId,
        agentId: resolvedRun?.agentId ?? fallback!.agentId,
        turnId: resolvedRun ? input.turnId : null,
        turnItemId: dispatchScope?.turnItemId ?? null,
        workflowRunStepId: dispatchScope?.workflowRunStepId ?? resolved?.workflowRunStepId ?? null,
        dispatchId: dispatchScope?.dispatchId ?? null,
        sensitivity: input.sensitivity,
        policySnapshotId: resolvedRun?.policySnapshotId ?? fallback?.policySnapshotId ?? null,
      },
    });

    if (inserted && resolvedRun) {
      await emitArtifactCreatedTx(tx, tenantId, input.turnId, artifact);
    }
    await emitArtifactAttachedTx(tx, tenantId, {
      turnId: input.turnId,
      turnItemId: dispatchScope?.turnItemId ?? null,
      workflowRunStepId: dispatchScope?.workflowRunStepId ?? resolved?.workflowRunStepId ?? null,
      dispatchId: dispatchScope?.dispatchId ?? null,
      artifact,
    });
  });

  return artifact;
}
