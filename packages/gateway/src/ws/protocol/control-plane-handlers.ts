import {
  WsCommandExecuteRequest,
  WsCommandExecuteResult,
  WsPingRequest,
  WsWorkflowCancelRequest,
  WsWorkflowCancelResult,
  WsWorkflowResumeRequest,
  WsWorkflowResumeResult,
  WsWorkflowStartRequest,
} from "@tyrum/contracts";
import type { WsResponseEnvelope } from "@tyrum/contracts";
import { executeCommand } from "../../app/modules/commands/dispatcher.js";
import { IdentityScopeDal, ScopeNotFoundError } from "../../app/modules/identity/scope.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { handleRunListMessage } from "./control-plane-handlers.turn-list.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { executeWorkflowStart } from "../../app/modules/execution/workflow-start.js";

function isInvalidRequestError(error: unknown): error is Error & { code: "invalid_request" } {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "invalid_request"
  );
}

export async function handleControlPlaneMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  switch (msg.type) {
    case "ping":
      return handlePingMessage(msg);
    case "command.execute":
      return handleCommandExecuteMessage(client, msg, deps);
    case "turn.list":
      return handleRunListMessage(client, msg, deps);
    case "workflow.start":
      return handleWorkflowRunMessage(client, msg, deps);
    case "workflow.resume":
      return handleWorkflowResumeMessage(client, msg, deps);
    case "workflow.cancel":
      return handleWorkflowCancelMessage(client, msg, deps);
    default:
      return undefined;
  }
}

function handlePingMessage(msg: ProtocolRequestEnvelope): WsResponseEnvelope {
  const parsedReq = WsPingRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }
  return { request_id: msg.request_id, type: msg.type, ok: true };
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
      key: parsedReq.data.payload.conversation_key,
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
  if (!deps.db || (!deps.policyService && !deps.agents)) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "workflow.start not supported",
    );
  }
  const parsedReq = WsWorkflowStartRequest.safeParse(msg);
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
    const identityScopeDal = deps.db
      ? (deps.identityScopeDal ?? new IdentityScopeDal(deps.db))
      : deps.identityScopeDal;
    const result = await executeWorkflowStart(
      {
        db: deps.db,
        policyService: deps.policyService,
        agents: deps.agents,
        identityScopeDal,
      },
      {
        tenantId,
        payload: parsedReq.data.payload,
      },
    );

    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    if (isInvalidRequestError(err)) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", err.message);
    }
    if (err instanceof ScopeNotFoundError) {
      return errorResponse(msg.request_id, msg.type, err.code, err.message);
    }
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
  if (!deps.workflowRunner) {
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

  const workflowRunId = await deps.workflowRunner.resumeRun(parsedReq.data.payload.token);
  if (!workflowRunId) {
    return errorResponse(msg.request_id, msg.type, "not_found", "resume token not found");
  }

  const result = WsWorkflowResumeResult.parse({ workflow_run_id: workflowRunId });
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
  if (!deps.workflowRunner) {
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

  const outcome = await deps.workflowRunner.cancelRun(
    parsedReq.data.payload.workflow_run_id,
    parsedReq.data.payload.reason,
  );
  if (outcome === "not_found") {
    return errorResponse(msg.request_id, msg.type, "not_found", "workflow run not found");
  }

  const result = WsWorkflowCancelResult.parse({
    workflow_run_id: parsedReq.data.payload.workflow_run_id,
    cancelled: outcome === "cancelled",
  });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}
