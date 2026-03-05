import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { NodeDispatchService } from "../agent/node-dispatch-service.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  resolveDesktopEvidenceSensitivity,
  shapeDesktopEvidenceForArtifacts,
} from "../desktop/shape-desktop-evidence.js";
import {
  resolveBrowserEvidenceSensitivity,
  shapeBrowserEvidenceForArtifacts,
} from "../browser/shape-browser-evidence.js";
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
    if (action.type !== "Desktop" && action.type !== "Browser") {
      return await this.opts.fallback.execute(action, planId, stepIndex, timeoutMs, context);
    }

    const startedAtMs = Date.now();

    try {
      const { taskId, result } = await this.opts.nodeDispatchService.dispatchAndWait(
        action,
        {
          tenantId: context.tenantId,
          runId: context.runId,
          stepId: context.stepId,
          attemptId: context.attemptId,
        },
        { timeoutMs },
      );

      const shaped =
        action.type === "Desktop"
          ? await (async () => {
              const sensitivity = await resolveDesktopEvidenceSensitivity(this.opts.db, {
                runId: context.runId,
                stepId: context.stepId,
              });

              return await shapeDesktopEvidenceForArtifacts({
                db: this.opts.db,
                artifactStore: this.opts.artifactStore,
                runId: context.runId,
                stepId: context.stepId,
                workspaceId: context.workspaceId,
                evidence: result.evidence,
                result: result.result,
                sensitivity,
              });
            })()
          : await shapeBrowserEvidenceForArtifacts({
              db: this.opts.db,
              artifactStore: this.opts.artifactStore,
              runId: context.runId,
              stepId: context.stepId,
              workspaceId: context.workspaceId,
              evidence: result.evidence,
              result: result.result,
              sensitivity: resolveBrowserEvidenceSensitivity(),
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
