import { randomUUID } from "node:crypto";
import type { ExecutionTrigger as ExecutionTriggerT } from "@tyrum/contracts";
import { parseTyrumKey, WorkspaceKey } from "@tyrum/contracts";
import { IdentityScopeDal } from "../../identity/scope.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeWorkspaceKey } from "./db.js";
import type { EnqueuePlanInput, EnqueuePlanResult } from "./types.js";
import type { QueueingDeps } from "./shared.js";

export async function enqueuePlanInTx(
  deps: QueueingDeps,
  tx: SqlDb,
  input: EnqueuePlanInput,
): Promise<EnqueuePlanResult> {
  const jobId = randomUUID();
  const runId = randomUUID();
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error("tenantId is required to enqueue execution plans");
  }
  let agentKey = "default";
  try {
    const parsedKey = parseTyrumKey(input.key as never);
    if (parsedKey.kind === "agent") {
      agentKey = parsedKey.agent_key;
    }
  } catch {
    // ignore; treat as default agent
  }

  const identityScopeDal = new IdentityScopeDal(tx);
  const agentId = await identityScopeDal.ensureAgentId(tenantId, agentKey);
  const workspaceId = await resolveWorkspaceId(identityScopeDal, tx, tenantId, input);
  await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

  const baseMetadata = {
    plan_id: input.planId,
    request_id: input.requestId,
    tenant_id: tenantId,
    agent_id: agentId,
    workspace_id: workspaceId,
  };

  const normalizeTriggerKind = (value: unknown): ExecutionTriggerT["kind"] => {
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
  };

  const trigger = (() => {
    if (!input.trigger) {
      return {
        kind: "session",
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

    const kind = normalizeTriggerKind(provided["kind"]);

    return {
      ...provided,
      kind,
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
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [
      tenantId,
      jobId,
      agentId,
      workspaceId,
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

export async function enqueuePlan(
  deps: QueueingDeps,
  input: EnqueuePlanInput,
): Promise<EnqueuePlanResult> {
  const res = await deps.db.transaction(async (tx) => {
    return await enqueuePlanInTx(deps, tx, input);
  });

  deps.logger?.info("execution.enqueue", {
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

async function resolveWorkspaceId(
  identityScopeDal: IdentityScopeDal,
  tx: SqlDb,
  tenantId: string,
  input: EnqueuePlanInput,
): Promise<string> {
  const explicitWorkspaceKey = input.workspaceKey?.trim();
  if (explicitWorkspaceKey) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, explicitWorkspaceKey);
  }

  const legacyWorkspace = input.workspaceId?.trim();
  if (!legacyWorkspace) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, normalizeWorkspaceKey(undefined));
  }

  const existing = await tx.get<{ workspace_id: string }>(
    "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_id = ? LIMIT 1",
    [tenantId, legacyWorkspace],
  );
  if (existing?.workspace_id) {
    return existing.workspace_id;
  }

  if (WorkspaceKey.safeParse(legacyWorkspace).success) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, legacyWorkspace);
  }

  return await identityScopeDal.ensureWorkspaceId(tenantId, normalizeWorkspaceKey(legacyWorkspace));
}
