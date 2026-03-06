import { UuidSchema, WsApprovalDecision, WsTaskExecuteResult } from "@tyrum/schemas";
import type { WsEventEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import { hasAnyRequiredScope } from "../../modules/auth/scopes.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorEvent } from "./helpers.js";
import type { ProtocolDeps, ProtocolResponseEnvelope } from "./types.js";

export async function handleResponseMessage(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | WsEventEnvelope | undefined> {
  if (msg.type === "ping" && msg.ok === true) {
    client.lastPong = Date.now();
    return undefined;
  }

  if (msg.type === "task.execute") {
    return handleTaskExecuteResponse(client, msg, deps);
  }

  if (msg.type === "approval.request") {
    return handleApprovalResponse(client, msg, deps);
  }

  return undefined;
}

function parseApprovalId(requestId: string): string | undefined {
  if (!requestId.startsWith("approval-")) return undefined;
  const raw = requestId.slice("approval-".length);
  const parsed = UuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function evidenceFromErrorDetails(details: unknown): unknown {
  if (details === null || typeof details !== "object") {
    return undefined;
  }
  return (details as { evidence?: unknown }).evidence;
}

function handleTaskExecuteResponse(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): WsEventEnvelope | undefined {
  if (client.role !== "node") {
    deps.logger?.warn("ws.task_result_unauthorized_role", {
      request_id: msg.request_id,
      connection_id: client.id,
      role: client.role,
    });
    return errorEvent("unauthorized", "only nodes may respond to task.execute");
  }

  const expectedConnectionId = deps.taskResults?.getAssociatedConnectionId(msg.request_id);
  if (expectedConnectionId && expectedConnectionId !== client.id) {
    deps.logger?.warn("ws.task_result_unexpected_connection", {
      request_id: msg.request_id,
      connection_id: client.id,
      expected_connection_id: expectedConnectionId,
    });
    return errorEvent("unauthorized", "task.execute result received from an unexpected connection");
  }

  const evidenceAndResult = msg.ok ? WsTaskExecuteResult.safeParse(msg.result ?? {}) : undefined;
  const failureEvidence = !msg.ok ? evidenceFromErrorDetails(msg.error.details) : undefined;

  deps.onTaskResult?.(
    msg.request_id,
    msg.ok,
    msg.ok ? (evidenceAndResult?.success ? evidenceAndResult.data.result : undefined) : undefined,
    msg.ok
      ? evidenceAndResult?.success
        ? evidenceAndResult.data.evidence
        : undefined
      : failureEvidence,
    msg.ok ? undefined : msg.error.message,
  );
  return undefined;
}

async function handleApprovalResponse(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): Promise<WsEventEnvelope | undefined> {
  const authClaims = client.auth_claims;
  if (!authClaims) {
    return errorEvent("unauthorized", "missing auth claims");
  }
  if (client.role !== "client") {
    return errorEvent("unauthorized", "only operator clients may resolve approvals");
  }
  if (
    authClaims.token_kind === "device" &&
    !hasAnyRequiredScope(authClaims, ["operator.approvals"])
  ) {
    await deps.authAudit?.recordAuthzDenied({
      surface: "ws",
      reason: "insufficient_scope",
      token: {
        token_kind: authClaims.token_kind,
        token_id: authClaims.token_id,
        device_id: authClaims.device_id,
        role: authClaims.role,
        scopes: authClaims.scopes,
      },
      tenant_id: authClaims.tenant_id ?? undefined,
      required_scopes: ["operator.approvals"],
      request_type: msg.type,
      request_id: msg.request_id,
      client_id: client.id,
    });
    return errorEvent("forbidden", "insufficient scope");
  }

  const approvalId = parseApprovalId(msg.request_id);
  if (approvalId === undefined) {
    return errorEvent(
      "invalid_approval_request_id",
      "approval response missing or invalid approval request id",
    );
  }

  if (!msg.ok) {
    return errorEvent(
      "approval_request_failed",
      `client error for ${msg.request_id} (${msg.error.code}): ${msg.error.message}`,
    );
  }

  const decision = WsApprovalDecision.safeParse(msg.result ?? {});
  if (!decision.success) {
    return errorEvent(
      "invalid_approval_decision",
      `invalid approval decision for ${msg.request_id}: ${decision.error.message}`,
    );
  }

  const tenantId = authClaims.tenant_id;
  if (!tenantId) {
    return errorEvent("unauthorized", "missing tenant_id");
  }
  deps.onApprovalDecision?.(tenantId, approvalId, decision.data.approved, decision.data.reason);
  return undefined;
}
