import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import { insertExecutionArtifactRowTx } from "../../artifact/execution-artifacts.js";
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
      runId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      agentId: string | null;
    },
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    if (artifacts.length === 0) return;

    const run = await tx.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [scope.tenantId, scope.runId],
    );
    const policySnapshotId = run?.policy_snapshot_id ?? null;

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
          runId: scope.runId,
          stepId: scope.stepId,
          attemptId: scope.attemptId,
          sensitivity: "normal",
          policySnapshotId,
        },
      });

      if (inserted) {
        await this.opts.eventEmitter.emitArtifactCreatedTx(tx, {
          tenantId: scope.tenantId,
          runId: scope.runId,
          artifact,
        });
      }
      await this.opts.eventEmitter.emitArtifactAttachedTx(tx, {
        tenantId: scope.tenantId,
        runId: scope.runId,
        stepId: scope.stepId,
        attemptId: scope.attemptId,
        artifact,
      });
    }
  }
}
