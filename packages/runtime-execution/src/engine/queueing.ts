import { randomUUID } from "node:crypto";
import type { TurnTrigger as TurnTriggerT } from "@tyrum/contracts";
import type {
  EnqueuePlanInput,
  EnqueuePlanResult,
  ExecutionDb,
  ExecutionEngineLogger,
  ExecutionTurnEventPort,
  ExecutionScopeResolver,
} from "./types.js";

interface QueueingDeps<TDb extends ExecutionDb<TDb>> extends ExecutionTurnEventPort<TDb> {
  db: TDb;
  logger?: ExecutionEngineLogger;
  scopeResolver: ExecutionScopeResolver<TDb>;
  emitTurnQueuedTx(tx: TDb, turnId: string): Promise<void>;
}

function normalizeTriggerKind(value: unknown): TurnTriggerT["kind"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "conversation" ||
    normalized === "cron" ||
    normalized === "heartbeat" ||
    normalized === "hook" ||
    normalized === "webhook" ||
    normalized === "manual" ||
    normalized === "api"
  ) {
    return normalized;
  }
  return "conversation";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const turnId = randomUUID();
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
        kind: "conversation" as const,
        conversation_key: input.key,
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
      conversation_key:
        typeof provided["conversation_key"] === "string" ? provided["conversation_key"] : input.key,
      metadata,
    };
  })();

  const triggerJson = JSON.stringify(trigger);
  const inputJson = JSON.stringify({
    ...(isRecord(input.inputPayload) ? input.inputPayload : {}),
    plan_id: input.planId,
    request_id: input.requestId,
  });

  await tx.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [
      tenantId,
      jobId,
      agentId,
      workspaceId,
      input.conversationId ?? null,
      input.key,
      triggerJson,
      inputJson,
      turnId,
      input.policySnapshotId ?? null,
    ],
  );

  await tx.run(
    `INSERT INTO turns (
       tenant_id,
       turn_id,
       job_id,
       conversation_key,
       status,
       attempt,
       policy_snapshot_id,
       budgets_json
     )
     VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)`,
    [
      tenantId,
      turnId,
      jobId,
      input.key,
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
         turn_id,
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
        turnId,
        idx,
        JSON.stringify(action),
        1,
        action.idempotency_key ?? null,
        action.postcondition ? JSON.stringify(action.postcondition) : null,
      ],
    );
  }

  await deps.emitTurnUpdatedTx(tx, turnId);
  await deps.emitTurnQueuedTx(tx, turnId);
  const stepIds = await tx.all<{ step_id: string }>(
    "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND turn_id = ? ORDER BY step_index ASC",
    [tenantId, turnId],
  );
  for (const row of stepIds) {
    await deps.emitStepUpdatedTx(tx, row.step_id);
  }
  return { jobId, turnId };
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
    turn_id: res.turnId,
    key: input.key,
    steps_count: input.steps.length,
  });
  return res;
}
