import { randomUUID } from "node:crypto";
import type { ExecutionTrigger as ExecutionTriggerT } from "@tyrum/contracts";
import type {
  EnqueuePlanInput,
  EnqueuePlanResult,
  ExecutionDb,
  ExecutionEngineLogger,
  ExecutionRunEventPort,
  ExecutionScopeResolver,
} from "./types.js";

interface QueueingDeps<TDb extends ExecutionDb<TDb>> extends ExecutionRunEventPort<TDb> {
  db: TDb;
  logger?: ExecutionEngineLogger;
  scopeResolver: ExecutionScopeResolver<TDb>;
  emitRunQueuedTx(tx: TDb, runId: string): Promise<void>;
}

function normalizeTriggerKind(value: unknown): ExecutionTriggerT["kind"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "session" ||
    normalized === "cron" ||
    normalized === "heartbeat" ||
    normalized === "hook" ||
    normalized === "webhook" ||
    normalized === "manual" ||
    normalized === "api"
  ) {
    return normalized;
  }
  return "session";
}

export async function enqueuePlanInTx<TDb extends ExecutionDb<TDb>>(
  deps: QueueingDeps<TDb>,
  tx: TDb,
  input: EnqueuePlanInput,
): Promise<EnqueuePlanResult> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error("tenantId is required to enqueue execution plans");
  }

  const jobId = randomUUID();
  const runId = randomUUID();
  const agentId = await deps.scopeResolver.resolveExecutionAgentId(tx, tenantId, input.key);
  const workspaceId = await deps.scopeResolver.resolveWorkspaceId(tx, tenantId, input);
  await deps.scopeResolver.ensureMembership(tx, tenantId, agentId, workspaceId);

  const baseMetadata = {
    plan_id: input.planId,
    request_id: input.requestId,
    tenant_id: tenantId,
    agent_id: agentId,
    workspace_id: workspaceId,
  };

  const trigger = (() => {
    if (!input.trigger) {
      return {
        kind: "session" as const,
        key: input.key,
        lane: input.lane,
        metadata: baseMetadata,
      };
    }

    const provided = input.trigger as Record<string, unknown>;
    const metadata =
      provided["metadata"] &&
      typeof provided["metadata"] === "object" &&
      !Array.isArray(provided["metadata"])
        ? { ...(provided["metadata"] as Record<string, unknown>), ...baseMetadata }
        : baseMetadata;

    return {
      ...provided,
      kind: normalizeTriggerKind(provided["kind"]),
      key: typeof provided["key"] === "string" ? provided["key"] : input.key,
      lane: typeof provided["lane"] === "string" ? provided["lane"] : input.lane,
      metadata,
    };
  })();

  const triggerJson = JSON.stringify(trigger);
  const inputJson = JSON.stringify({
    plan_id: input.planId,
    request_id: input.requestId,
  });

  await tx.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       session_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [
      tenantId,
      jobId,
      agentId,
      workspaceId,
      input.sessionId ?? null,
      input.key,
      input.lane,
      triggerJson,
      inputJson,
      runId,
      input.policySnapshotId ?? null,
    ],
  );

  await tx.run(
    `INSERT INTO execution_runs (
       tenant_id,
       run_id,
       job_id,
       key,
       lane,
       status,
       attempt,
       policy_snapshot_id,
       budgets_json
     )
     VALUES (?, ?, ?, ?, ?, 'queued', 1, ?, ?)`,
    [
      tenantId,
      runId,
      jobId,
      input.key,
      input.lane,
      input.policySnapshotId ?? null,
      input.budgets ? JSON.stringify(input.budgets) : null,
    ],
  );

  for (let idx = 0; idx < input.steps.length; idx += 1) {
    const stepId = randomUUID();
    const action = input.steps[idx]!;
    await tx.run(
      `INSERT INTO execution_steps (
         tenant_id,
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         max_attempts,
         idempotency_key,
         postcondition_json
       ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        tenantId,
        stepId,
        runId,
        idx,
        JSON.stringify(action),
        1,
        action.idempotency_key ?? null,
        action.postcondition ? JSON.stringify(action.postcondition) : null,
      ],
    );
  }

  await deps.emitRunUpdatedTx(tx, runId);
  await deps.emitRunQueuedTx(tx, runId);
  const stepIds = await tx.all<{ step_id: string }>(
    "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
    [tenantId, runId],
  );
  for (const row of stepIds) {
    await deps.emitStepUpdatedTx(tx, row.step_id);
  }
  return { jobId, runId };
}

export async function enqueuePlan<TDb extends ExecutionDb<TDb>>(
  deps: QueueingDeps<TDb>,
  input: EnqueuePlanInput,
): Promise<EnqueuePlanResult> {
  const res = await deps.db.transaction(async (tx) => await enqueuePlanInTx(deps, tx, input));

  deps.logger?.info?.("execution.enqueue", {
    tenant_id: input.tenantId,
    request_id: input.requestId,
    plan_id: input.planId,
    job_id: res.jobId,
    run_id: res.runId,
    key: input.key,
    lane: input.lane,
    steps_count: input.steps.length,
  });
  return res;
}
