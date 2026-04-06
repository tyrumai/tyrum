import { defaultExecutionClock, type WorkerTickInput } from "@tyrum/runtime-execution";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import { claimNextWorkflowRunStep } from "./runner-claim.js";
import { cancelWorkflowRun, resumeWorkflowRun } from "./runner-control.js";
import { executeWorkflowRunClaim } from "./runner-execution.js";
import { listRunnableWorkflowRuns, type WorkflowRunRunnerServices } from "./runner-shared.js";

export interface WorkflowRunRunnerOptions {
  db: SqlDb;
  policyService?: PolicyService;
  redactText?: (text: string) => string;
  redactUnknown?: <T>(value: T) => T;
}

export class WorkflowRunRunner {
  private readonly services: WorkflowRunRunnerServices;

  constructor(options: WorkflowRunRunnerOptions) {
    const redactText = options.redactText ?? ((text: string) => text);
    const redactUnknown = options.redactUnknown ?? (<T>(value: T) => value);
    this.services = {
      db: options.db,
      policyService: options.policyService,
      redactText,
      redactUnknown,
    };
  }

  async workerTick(input: WorkerTickInput & { workflowRunId?: string }): Promise<boolean> {
    const clock = defaultExecutionClock();
    const runs = await listRunnableWorkflowRuns(this.services.db, input.workflowRunId);
    for (const run of runs) {
      const claim = await claimNextWorkflowRunStep(
        this.services,
        run,
        input.workerId,
        clock.nowMs,
        clock.nowIso,
      );
      if (!claim) {
        continue;
      }
      await executeWorkflowRunClaim(this.services, claim, input.executor);
      return true;
    }
    return false;
  }

  async resumeRun(token: string): Promise<string | undefined> {
    return await resumeWorkflowRun(this.services, token);
  }

  async cancelRun(
    workflowRunId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    return await cancelWorkflowRun(this.services, workflowRunId, reason);
  }
}
