import {
  WsCommandExecuteRequest,
  WsCommandExecuteResult,
  WsPingRequest,
  WsWorkflowCancelRequest,
  WsWorkflowCancelResult,
  WsWorkflowResumeRequest,
  WsWorkflowResumeResult,
  WsWorkflowRunRequest,
  WsWorkflowRunResult,
  parseTyrumKey,
} from "@tyrum/schemas";
import type { WsResponseEnvelope } from "@tyrum/schemas";
import { executeCommand } from "../../modules/commands/dispatcher.js";
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
    const agentId = keyParsed.kind === "agent" ? keyParsed.agent_key : "default";
    const policy = deps.agents ? deps.agents.getPolicyService(agentId) : deps.policyService!;
    const effectivePolicy = await policy.loadEffectiveBundle();
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
