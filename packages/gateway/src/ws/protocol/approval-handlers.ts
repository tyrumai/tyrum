import {
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveResponse,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
} from "@tyrum/schemas";
import type { Approval as ApprovalT, WsResponseEnvelope } from "@tyrum/schemas";
import { resolveApproval } from "../../modules/approval/resolve-service.js";
import { toApprovalContract } from "../../modules/approval/to-contract.js";
import type { ConnectedClient } from "../connection-manager.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleApprovalMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "approval.list") {
    return handleApprovalListMessage(client, msg, deps);
  }

  if (msg.type === "approval.resolve") {
    return handleApprovalResolveMessage(client, msg, deps);
  }

  return undefined;
}

async function handleApprovalListMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may list approvals",
    );
  }
  if (!deps.approvalDal) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "approval.list not supported",
    );
  }
  const parsedReq = WsApprovalListRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const filter = ApprovalListRequest.parse(parsedReq.data.payload);
  const status = filter.status;
  const limit = Math.max(1, Math.min(500, filter.limit));

  const rows =
    status === undefined
      ? await deps.approvalDal.getPending({ tenantId })
      : status === "cancelled"
        ? []
        : await deps.approvalDal.getByStatus({ tenantId, status });

  const approvals = rows
    .map(toApprovalContract)
    .filter((approval): approval is ApprovalT => Boolean(approval))
    .filter((approval) => {
      if (filter.kind && filter.kind.length > 0 && !filter.kind.includes(approval.kind)) {
        return false;
      }
      if (filter.key && approval.scope?.key !== filter.key) return false;
      if (filter.lane && approval.scope?.lane !== filter.lane) return false;
      if (filter.run_id && approval.scope?.run_id !== filter.run_id) return false;
      return true;
    })
    .slice(0, limit);
  const result = ApprovalListResponse.parse({ approvals, next_cursor: undefined });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

async function handleApprovalResolveMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may resolve approvals",
    );
  }
  if (!deps.approvalDal) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "approval.resolve not supported",
    );
  }

  const parsedReq = WsApprovalResolveRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const req = parsedReq.data.payload;
  const result = await resolveApproval(
    {
      approvalDal: deps.approvalDal,
      policyOverrideDal: deps.policyOverrideDal,
      wsEventDal: deps.wsEventDal,
      emitEvent: ({ tenantId: eventTenantId, event, audience }) => {
        broadcastEvent(eventTenantId, event, deps, audience);
      },
    },
    {
      tenantId,
      approvalId: req.approval_id,
      decision: req.decision,
      reason: req.reason,
      mode: req.mode,
      overrides: req.overrides,
      resolvedBy: { kind: "ws", client_id: client.id, device_id: client.device_id },
    },
  );
  if (!result.ok) {
    return errorResponse(
      msg.request_id,
      msg.type,
      result.code === "unsupported" ? "unsupported_request" : result.code,
      result.message,
    );
  }

  const approval = toApprovalContract(result.approval);
  if (!approval) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "invalid_state",
      `approval ${String(result.approval.approval_id)} could not be converted to contract`,
    );
  }
  return {
    request_id: msg.request_id,
    type: msg.type,
    ok: true,
    result: ApprovalResolveResponse.parse({
      approval,
      created_overrides: result.createdOverrides,
    }),
  };
}
