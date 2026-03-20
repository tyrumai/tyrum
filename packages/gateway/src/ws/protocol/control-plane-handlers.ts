import {
  WsCommandExecuteRequest,
  WsCommandExecuteResult,
  WsPingRequest,
  WsRunListRequest,
  WsRunListResult,
  WsWorkflowCancelRequest,
  WsWorkflowCancelResult,
  WsWorkflowResumeRequest,
  WsWorkflowResumeResult,
  WsWorkflowRunRequest,
  WsWorkflowRunResult,
  parseTyrumKey,
} from "@tyrum/contracts";
import type { WsResponseEnvelope } from "@tyrum/contracts";
import { executeCommand } from "../../modules/commands/dispatcher.js";
import { IdentityScopeDal, requirePrimaryAgentKey } from "../../modules/identity/scope.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleControlPlaneMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "ping") {
    return handlePingMessage(msg);
  }

  if (msg.type === "command.execute") {
    return handleCommandExecuteMessage(client, msg, deps);
  }

  if (msg.type === "run.list") {
    return handleRunListMessage(client, msg, deps);
  }

  if (msg.type === "workflow.run") {
    return handleWorkflowRunMessage(client, msg, deps);
  }

  if (msg.type === "workflow.resume") {
    return handleWorkflowResumeMessage(client, msg, deps);
  }

  if (msg.type !== "workflow.cancel") {
    return undefined;
  }

  return handleWorkflowCancelMessage(client, msg, deps);
}

function handlePingMessage(msg: ProtocolRequestEnvelope): WsResponseEnvelope {
  const parsedReq = WsPingRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }
  return {
    request_id: msg.request_id,
    type: msg.type,
    ok: true,
  };
}

function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function handleRunListMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may list runs",
    );
  }
  if (!deps.db) {
    return errorResponse(msg.request_id, msg.type, "unsupported_request", "run.list not supported");
  }

  const parsedReq = WsRunListRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  const limit = parsedReq.data.payload.limit ?? 100;
  const statuses = parsedReq.data.payload.statuses ?? [];
  const statusClause =
    statuses.length > 0 ? ` AND r.status IN (${buildSqlPlaceholders(statuses.length)})` : "";

  const runRows = await deps.db.all<{
    run_id: string;
    job_id: string;
    key: string;
    lane: string;
    status: string;
    attempt: number;
    created_at: string | Date;
    started_at: string | Date | null;
    finished_at: string | Date | null;
    paused_reason: string | null;
    paused_detail: string | null;
    policy_snapshot_id: string | null;
    budgets_json: string | null;
    budget_overridden_at: string | Date | null;
    agent_key: string | null;
  }>(
    `SELECT
       r.run_id,
       r.job_id,
       r.key,
       r.lane,
       r.status,
       r.attempt,
       r.created_at,
       r.started_at,
       r.finished_at,
       r.paused_reason,
       r.paused_detail,
       r.policy_snapshot_id,
       r.budgets_json,
       r.budget_overridden_at,
       ag.agent_key AS agent_key
     FROM execution_runs r
     JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     LEFT JOIN agents ag ON ag.tenant_id = j.tenant_id AND ag.agent_id = j.agent_id
     WHERE r.tenant_id = ?${statusClause}
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [tenantId, ...statuses, limit],
  );

  const runIds = runRows.map((row) => row.run_id);
  const stepRows =
    runIds.length === 0
      ? []
      : await deps.db.all<{
          step_id: string;
          run_id: string;
          step_index: number;
          status: string;
          action_json: string;
          created_at: string | Date;
          idempotency_key: string | null;
          postcondition_json: string | null;
          approval_id: string | null;
        }>(
          `SELECT
             step_id,
             run_id,
             step_index,
             status,
             action_json,
             created_at,
             idempotency_key,
             postcondition_json,
             approval_id
           FROM execution_steps
           WHERE tenant_id = ?
             AND run_id IN (${buildSqlPlaceholders(runIds.length)})
           ORDER BY created_at ASC, step_index ASC`,
          [tenantId, ...runIds],
        );

  const stepIds = stepRows.map((row) => row.step_id);
  const attemptRows =
    stepIds.length === 0
      ? []
      : await deps.db.all<{
          attempt_id: string;
          step_id: string;
          attempt: number;
          status: string;
          started_at: string | Date;
          finished_at: string | Date | null;
          result_json: string | null;
          error: string | null;
          postcondition_report_json: string | null;
          artifacts_json: string;
          cost_json: string | null;
          metadata_json: string | null;
          policy_snapshot_id: string | null;
          policy_decision_json: string | null;
          policy_applied_override_ids_json: string | null;
        }>(
          `SELECT
             attempt_id,
             step_id,
             attempt,
             status,
             started_at,
             finished_at,
             result_json,
             error,
             postcondition_report_json,
             artifacts_json,
             cost_json,
             metadata_json,
             policy_snapshot_id,
             policy_decision_json,
             policy_applied_override_ids_json
           FROM execution_attempts
           WHERE tenant_id = ?
             AND step_id IN (${buildSqlPlaceholders(stepIds.length)})
           ORDER BY started_at ASC, attempt ASC`,
          [tenantId, ...stepIds],
        );

  const result = WsRunListResult.parse({
    runs: runRows.map((row) => {
      const run = {
        run_id: row.run_id,
        job_id: row.job_id,
        key: row.key,
        lane: row.lane,
        status: row.status,
        attempt: row.attempt,
        created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
        started_at: normalizeDbDateTime(row.started_at),
        finished_at: normalizeDbDateTime(row.finished_at),
        paused_reason: row.paused_reason ?? undefined,
        paused_detail: row.paused_detail ?? undefined,
        policy_snapshot_id: row.policy_snapshot_id ?? undefined,
        budgets: safeJsonParse(row.budgets_json, undefined as unknown),
        budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
      };
      const runItem: { run: typeof run; agent_key?: string } = { run };
      if (row.agent_key) {
        runItem.agent_key = row.agent_key;
      }
      return runItem;
    }),
    steps: stepRows.map((row) => ({
      step_id: row.step_id,
      run_id: row.run_id,
      step_index: row.step_index,
      status: row.status,
      action: safeJsonParse(row.action_json, {}),
      created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
      idempotency_key: row.idempotency_key ?? undefined,
      postcondition: safeJsonParse(row.postcondition_json, undefined as unknown),
      approval_id: row.approval_id ?? undefined,
    })),
    attempts: attemptRows.map((row) => ({
      attempt_id: row.attempt_id,
      step_id: row.step_id,
      attempt: row.attempt,
      status: row.status,
      started_at: normalizeDbDateTime(row.started_at) ?? new Date().toISOString(),
      finished_at: normalizeDbDateTime(row.finished_at),
      result: safeJsonParse(row.result_json, undefined as unknown),
      error: row.error,
      postcondition_report: safeJsonParse(row.postcondition_report_json, undefined as unknown),
      artifacts: safeJsonParse(row.artifacts_json, [] as unknown[]),
      cost: safeJsonParse(row.cost_json, undefined as unknown),
      metadata: safeJsonParse(row.metadata_json, undefined as unknown),
      policy_snapshot_id: row.policy_snapshot_id ?? undefined,
      policy_decision: safeJsonParse(row.policy_decision_json, undefined as unknown),
      policy_applied_override_ids: safeJsonParse(
        row.policy_applied_override_ids_json,
        undefined as unknown,
      ),
    })),
  });

  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

async function handleCommandExecuteMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may execute commands",
    );
  }

  const parsedReq = WsCommandExecuteRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const resultPayload = await executeCommand(parsedReq.data.payload.command, {
    tenantId: client.auth_claims?.tenant_id ?? undefined,
    runtime: deps.runtime,
    commandContext: {
      agentId: parsedReq.data.payload.agent_id,
      channel: parsedReq.data.payload.channel,
      threadId: parsedReq.data.payload.thread_id ?? undefined,
      key: parsedReq.data.payload.key,
      lane: parsedReq.data.payload.lane,
    },
    connectionManager: deps.connectionManager,
    db: deps.db,
    approvalDal: deps.approvalDal,
    presenceDal: deps.presenceDal,
    nodePairingDal: deps.nodePairingDal,
    policyService: deps.policyService,
    policyOverrideDal: deps.policyOverrideDal,
    contextReportDal: deps.contextReportDal,
    plugins: deps.plugins,
    pluginCatalogProvider: deps.pluginCatalogProvider,
    modelsDev: deps.modelsDev,
    modelCatalog: deps.modelCatalog,
    agents: deps.agents,
  });

  if (deps.hooks) {
    void deps.hooks
      .fire({
        event: "command.execute",
        tenantId: client.auth_claims?.tenant_id ?? undefined,
        metadata: { command: parsedReq.data.payload.command },
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("hooks.fire_failed", {
          request_id: msg.request_id,
          client_id: client.id,
          request_type: msg.type,
          event: "command.execute",
          error: message,
        });
      });
  }

  const result = WsCommandExecuteResult.parse({
    output: resultPayload.output,
    data: resultPayload.data,
  });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

async function handleWorkflowRunMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may run workflows",
    );
  }
  if (!deps.engine || (!deps.policyService && !deps.agents)) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "workflow.run not supported",
    );
  }
  const parsedReq = WsWorkflowRunRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  try {
    const planId = parsedReq.data.payload.plan_id ?? `plan-${crypto.randomUUID()}`;
    const requestId = parsedReq.data.payload.request_id ?? `req-${crypto.randomUUID()}`;

    const keyParsed = parseTyrumKey(parsedReq.data.payload.key);
    const identityScopeDal = deps.db
      ? (deps.identityScopeDal ?? new IdentityScopeDal(deps.db))
      : deps.identityScopeDal;
    const agentKey =
      keyParsed.kind === "agent"
        ? keyParsed.agent_key
        : identityScopeDal
          ? await requirePrimaryAgentKey(identityScopeDal, tenantId)
          : (() => {
              throw new Error("primary agent resolution requires db access");
            })();
    const policy = deps.agents ? deps.agents.getPolicyService(agentKey) : deps.policyService!;
    const agentId = identityScopeDal
      ? await identityScopeDal.resolveAgentId(tenantId, agentKey)
      : undefined;
    if (identityScopeDal && !agentId) {
      return errorResponse(msg.request_id, msg.type, "not_found", `agent '${agentKey}' not found`);
    }
    const effectivePolicy = await policy.loadEffectiveBundle({
      tenantId,
      agentId: agentId ?? undefined,
    });
    const snapshot = await policy.getOrCreateSnapshot(tenantId, effectivePolicy.bundle);

    const queued = await deps.engine.enqueuePlan({
      tenantId,
      key: parsedReq.data.payload.key,
      lane: parsedReq.data.payload.lane,
      planId,
      requestId,
      steps: parsedReq.data.payload.steps,
      policySnapshotId: snapshot.policy_snapshot_id,
      budgets: parsedReq.data.payload.budgets,
    });

    const result = WsWorkflowRunResult.parse({
      job_id: queued.jobId,
      run_id: queued.runId,
      plan_id: planId,
      request_id: requestId,
      key: parsedReq.data.payload.key,
      lane: parsedReq.data.payload.lane,
      steps_count: parsedReq.data.payload.steps.length,
    });

    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.error("ws.workflow_run_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "internal_error", message);
  }
}

async function handleWorkflowResumeMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may resume workflows",
    );
  }
  if (!deps.engine) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "workflow.resume not supported",
    );
  }
  const parsedReq = WsWorkflowResumeRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const runId = await deps.engine.resumeRun(parsedReq.data.payload.token);
  if (!runId) {
    return errorResponse(msg.request_id, msg.type, "not_found", "resume token not found");
  }

  const result = WsWorkflowResumeResult.parse({ run_id: runId });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

async function handleWorkflowCancelMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may cancel workflows",
    );
  }
  if (!deps.engine) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "workflow.cancel not supported",
    );
  }
  const parsedReq = WsWorkflowCancelRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const outcome = await deps.engine.cancelRun(
    parsedReq.data.payload.run_id,
    parsedReq.data.payload.reason,
  );
  if (outcome === "not_found") {
    return errorResponse(msg.request_id, msg.type, "not_found", "run not found");
  }

  const result = WsWorkflowCancelResult.parse({
    run_id: parsedReq.data.payload.run_id,
    cancelled: outcome === "cancelled",
  });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}
