import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import { insertExecutionArtifactRowTx } from "../../artifact/execution-artifacts.js";
import { resolveWorkflowRunStepIdForExecutionStep } from "../workflow-run-step-id.js";
import type { ExecutionArtifactPort, ExecutionEventPort } from "./types.js";

type RedactUnknownFn = (value: unknown) => unknown;

export class ExecutionEngineArtifactRecorder implements ExecutionArtifactPort<SqlDb> {
  constructor(
    private readonly opts: {
      redactUnknown: RedactUnknownFn;
      eventEmitter: Pick<
        ExecutionEventPort<SqlDb>,
        "emitArtifactCreatedTx" | "emitArtifactAttachedTx"
      >;
    },
  ) {}

  async recordArtifactsTx(
    tx: SqlDb,
    scope: {
      tenantId: string;
      turnId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      agentId: string | null;
    },
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    if (artifacts.length === 0) return;

    const run = await tx.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM turns WHERE tenant_id = ? AND turn_id = ?",
      [scope.tenantId, scope.turnId],
    );
    const policySnapshotId = run?.policy_snapshot_id ?? null;
    const workflowRunStepId = await resolveWorkflowRunStepIdForExecutionStep({
      db: tx,
      tenantId: scope.tenantId,
      turnId: scope.turnId,
      stepId: scope.stepId,
    });

    for (const artifact of artifacts) {
      const labelsJson = JSON.stringify(this.opts.redactUnknown(artifact.labels ?? []));
      const metadataJson = JSON.stringify(this.opts.redactUnknown(artifact.metadata ?? {}));

      const { inserted } = await insertExecutionArtifactRowTx(tx, {
        artifact,
        labelsJson,
        metadataJson,
        scope: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agentId: scope.agentId,
          turnId: scope.turnId,
          turnItemId: null,
          workflowRunStepId,
          dispatchId: null,
          sensitivity: "normal",
          policySnapshotId,
        },
      });

      if (inserted) {
        await this.opts.eventEmitter.emitArtifactCreatedTx(tx, {
          tenantId: scope.tenantId,
          turnId: scope.turnId,
          artifact,
        });
      }
      await this.opts.eventEmitter.emitArtifactAttachedTx(tx, {
        tenantId: scope.tenantId,
        turnId: scope.turnId,
        workflowRunStepId,
        artifact,
      });
    }
  }
}
