import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import type { NodeDispatchService } from "@tyrum/runtime-node-control";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  resolveDesktopEvidenceSensitivity,
  shapeDesktopEvidenceForArtifacts,
} from "../desktop/shape-desktop-evidence.js";
import {
  resolveBrowserEvidenceSensitivity,
  shapeBrowserEvidenceForArtifacts,
} from "../browser/shape-browser-evidence.js";
import {
  resolveMobileEvidenceSensitivity,
  shapeMobileEvidenceForArtifacts,
} from "../mobile/shape-mobile-evidence.js";
import { resolveWorkflowRunStepIdTx } from "./workflow-run-step-id.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";

export interface NodeDispatchStepExecutorOptions {
  db: SqlDb;
  artifactStore: ArtifactStore;
  nodeDispatchService: NodeDispatchService;
  fallback: StepExecutor;
}

export function createNodeDispatchStepExecutor(
  opts: NodeDispatchStepExecutorOptions,
): StepExecutor {
  return new NodeDispatchStepExecutor(opts);
}

class NodeDispatchStepExecutor implements StepExecutor {
  constructor(private readonly opts: NodeDispatchStepExecutorOptions) {}

  async execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    if (
      action.type !== "Desktop" &&
      action.type !== "Browser" &&
      action.type !== "IOS" &&
      action.type !== "Android"
    ) {
      return await this.opts.fallback.execute(action, planId, stepIndex, timeoutMs, context);
    }

    const startedAtMs = Date.now();
    const workflowRunStepId =
      typeof this.opts.db.get === "function"
        ? await resolveWorkflowRunStepIdTx({
            tx: this.opts.db,
            tenantId: context.tenantId,
            turnId: context.turnId,
            stepIndex,
          })
        : null;

    try {
      const { taskId, dispatchId, result } = await this.opts.nodeDispatchService.dispatchAndWait(
        action,
        {
          tenantId: context.tenantId,
          turnId: context.turnId,
          workflowRunStepId,
          policySnapshotId: context.policySnapshotId ?? null,
        },
        { timeoutMs },
      );

      const shaped =
        action.type === "Desktop"
          ? await (async () => {
              const sensitivity = await resolveDesktopEvidenceSensitivity(this.opts.db, {
                tenantId: context.tenantId,
                turnId: context.turnId,
                stepId: context.stepId,
                dispatchId,
              });

              return await shapeDesktopEvidenceForArtifacts({
                db: this.opts.db,
                artifactStore: this.opts.artifactStore,
                turnId: context.turnId,
                stepId: context.stepId,
                dispatchId,
                workspaceId: context.workspaceId,
                fallbackScope: {
                  tenantId: context.tenantId,
                  workspaceId: context.workspaceId,
                  agentId: context.agentId ?? null,
                  policySnapshotId: context.policySnapshotId ?? null,
                },
                evidence: result.evidence,
                result: result.result,
                sensitivity,
              });
            })()
          : action.type === "Browser"
            ? await shapeBrowserEvidenceForArtifacts({
                db: this.opts.db,
                artifactStore: this.opts.artifactStore,
                turnId: context.turnId,
                stepId: context.stepId,
                dispatchId,
                workspaceId: context.workspaceId,
                fallbackScope: {
                  tenantId: context.tenantId,
                  workspaceId: context.workspaceId,
                  agentId: context.agentId ?? null,
                  policySnapshotId: context.policySnapshotId ?? null,
                },
                evidence: result.evidence,
                result: result.result,
                sensitivity: resolveBrowserEvidenceSensitivity(),
              })
            : await shapeMobileEvidenceForArtifacts({
                db: this.opts.db,
                artifactStore: this.opts.artifactStore,
                turnId: context.turnId,
                stepId: context.stepId,
                dispatchId,
                workspaceId: context.workspaceId,
                fallbackScope: {
                  tenantId: context.tenantId,
                  workspaceId: context.workspaceId,
                  agentId: context.agentId ?? null,
                  policySnapshotId: context.policySnapshotId ?? null,
                },
                evidence: result.evidence,
                result: result.result,
                sensitivity: resolveMobileEvidenceSensitivity(),
                platformLabel: action.type === "IOS" ? "ios" : "android",
              });

      const cost = { duration_ms: Math.max(0, Date.now() - startedAtMs) };
      const evidence =
        shaped.evidence === undefined || shaped.evidence === null
          ? undefined
          : { json: shaped.evidence };

      const stepResult: StepResult = {
        success: result.ok,
        result: { task_id: taskId },
        evidence,
        artifacts: shaped.artifacts.length > 0 ? shaped.artifacts : undefined,
        cost,
      };

      if (!result.ok) {
        stepResult.error = result.error ?? `${action.type} task failed`;
      }

      return stepResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        cost: { duration_ms: Math.max(0, Date.now() - startedAtMs) },
      };
    }
  }
}
