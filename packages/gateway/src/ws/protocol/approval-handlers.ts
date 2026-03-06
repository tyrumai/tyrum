import {
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
} from "@tyrum/schemas";
import type { Approval as ApprovalT, WsResponseEnvelope } from "@tyrum/schemas";
import type { ApprovalRow } from "../../modules/approval/dal.js";
import { toApprovalContract } from "../../modules/approval/to-contract.js";
import { isSafeSuggestedOverridePattern } from "../../modules/policy/override-guardrails.js";
import { APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE, APPROVAL_WS_AUDIENCE } from "../audience.js";
import type { ConnectedClient } from "../connection-manager.js";
import { ensureApprovalResolvedEvent, ensurePolicyOverrideCreatedEvent } from "../stable-events.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

type ApprovalResolveRequestPayload = ReturnType<typeof ApprovalResolveRequest.parse>;

type PolicyOverridesContext = {
  selectedOverrides?: Array<{ tool_id: string; pattern: string; workspace_id?: string }>;
  createOverrideContext?: {
    agentId: string;
    policySnapshotId?: string;
    approvalId: string;
  };
};

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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractSuggestedOverrides(
  approvalContext: unknown,
): Array<{ tool_id: string; pattern: string; workspace_id?: string }> {
  if (!isObject(approvalContext)) return [];
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return [];
  const suggested = policy["suggested_overrides"];
  if (!Array.isArray(suggested)) return [];

  const overrides: Array<{ tool_id: string; pattern: string; workspace_id?: string }> = [];
  for (const entry of suggested) {
    if (!isObject(entry)) continue;
    const toolId = entry["tool_id"];
    const pattern = entry["pattern"];
    const workspaceId = entry["workspace_id"];
    if (typeof toolId === "string" && typeof pattern === "string") {
      overrides.push({
        tool_id: toolId,
        pattern,
        workspace_id: typeof workspaceId === "string" ? workspaceId : undefined,
      });
    }
  }
  return overrides;
}

function extractPolicySnapshotId(approvalContext: unknown): string | undefined {
  if (!isObject(approvalContext)) return undefined;
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return undefined;
  const value = policy["policy_snapshot_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function extractAgentId(approvalContext: unknown): string | undefined {
  if (!isObject(approvalContext)) return undefined;
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return undefined;
  const value = policy["agent_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

  const req = ApprovalResolveRequest.parse(parsedReq.data.payload);
  const policyOverrides = await preparePolicyOverrides(msg, req, tenantId, deps);
  if ("response" in policyOverrides) {
    return policyOverrides.response;
  }

  const resolved = await deps.approvalDal.resolveWithEngineAction({
    tenantId,
    approvalId: req.approval_id,
    decision: req.decision,
    reason: req.reason,
    resolvedBy: { kind: "ws", client_id: client.id },
  });
  if (!resolved) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "not_found",
      `approval ${String(req.approval_id)} not found`,
    );
  }

  return finalizeApprovalResolve({
    client,
    msg,
    deps,
    tenantId,
    req,
    updated: resolved.approval,
    transitioned: resolved.transitioned,
    policyOverrides,
  });
}

async function finalizeApprovalResolve(params: {
  client: ConnectedClient;
  msg: ProtocolRequestEnvelope;
  deps: ProtocolDeps;
  tenantId: string;
  req: ApprovalResolveRequestPayload;
  updated: ApprovalRow;
  transitioned: boolean;
  policyOverrides: PolicyOverridesContext;
}): Promise<WsResponseEnvelope> {
  const { client, msg, deps, tenantId, req, updated, transitioned, policyOverrides } = params;
  const desiredStatus = req.decision === "approved" ? "approved" : "denied";
  const decisionMatches = updated.status === desiredStatus;
  if (updated.status !== desiredStatus) {
    deps.logger?.warn("approval.decision_mismatch", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      approval_id: updated.approval_id,
      decision: req.decision,
      status: updated.status,
    });
  }

  let createdOverrides: unknown[] | undefined;
  if (
    transitioned &&
    decisionMatches &&
    updated.status === "approved" &&
    req.mode === "always" &&
    policyOverrides.selectedOverrides &&
    policyOverrides.createOverrideContext
  ) {
    createdOverrides = await createPolicyOverrides({
      tenantId,
      deps,
      selectedOverrides: policyOverrides.selectedOverrides,
      createOverrideContext: policyOverrides.createOverrideContext,
    });
  }

  const approval = toApprovalContract(updated);
  if (!approval) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "invalid_state",
      `approval ${String(updated.approval_id)} could not be converted to contract`,
    );
  }
  const result = buildApprovalResolveResult(approval, createdOverrides);

  if (transitioned) {
    const persistedEvent = await ensureApprovalResolvedEvent({
      tenantId,
      approval,
      wsEventDal: deps.wsEventDal,
    });
    broadcastEvent(tenantId, persistedEvent.event, deps, APPROVAL_WS_AUDIENCE);
  }
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

async function preparePolicyOverrides(
  msg: ProtocolRequestEnvelope,
  req: ApprovalResolveRequestPayload,
  tenantId: string,
  deps: ProtocolDeps,
): Promise<{ response: WsResponseEnvelope } | PolicyOverridesContext> {
  if (req.decision !== "approved" || req.mode !== "always") {
    return {};
  }
  if (!deps.policyOverrideDal || !deps.approvalDal) {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "policy overrides not supported",
      ),
    };
  }

  const existingResult = await loadApprovalForAlwaysMode(msg, req, tenantId, deps);
  if ("response" in existingResult) {
    return existingResult;
  }
  const existing = existingResult.existing;
  if (existing.status !== "pending") {
    const approval = toApprovalContract(existing);
    if (!approval) {
      return {
        response: errorResponse(
          msg.request_id,
          msg.type,
          "invalid_state",
          `approval ${String(existing.approval_id)} could not be converted to contract`,
        ),
      };
    }
    return {
      response: {
        request_id: msg.request_id,
        type: msg.type,
        ok: true,
        result: ApprovalResolveResponse.parse({ approval }),
      },
    };
  }

  const suggested = extractSuggestedOverrides(existing.context);
  const selected = Array.isArray(req.overrides) ? req.overrides : [];
  if (selected.length === 0) {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        "mode=always requires selecting overrides",
      ),
    };
  }

  const validationError = validateSelectedOverrides(msg, suggested, selected);
  if (validationError) {
    return { response: validationError };
  }

  return {
    selectedOverrides: selected,
    createOverrideContext: {
      agentId: extractAgentId(existing.context) ?? "default",
      policySnapshotId: extractPolicySnapshotId(existing.context),
      approvalId: existing.approval_id,
    },
  };
}

function validateSelectedOverrides(
  msg: ProtocolRequestEnvelope,
  suggested: Array<{ tool_id: string; pattern: string; workspace_id?: string }>,
  selected: Array<{ tool_id: string; pattern: string; workspace_id?: string }>,
): WsResponseEnvelope | undefined {
  const allowed = new Set(
    suggested.map((override) => {
      return `${override.tool_id}::${override.pattern}::${override.workspace_id ?? ""}`;
    }),
  );

  for (const selectedOverride of selected) {
    const key = `${selectedOverride.tool_id}::${selectedOverride.pattern}::${selectedOverride.workspace_id ?? ""}`;
    if (!allowed.has(key)) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        "requested overrides must be selected from suggested_overrides",
      );
    }
    if (!isSafeSuggestedOverridePattern(selectedOverride.pattern)) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        "requested overrides violate deny guardrails",
      );
    }
  }

  return undefined;
}

function buildApprovalResolveResult(approval: ApprovalT, createdOverrides: unknown[] | undefined) {
  return ApprovalResolveResponse.parse({
    approval,
    created_overrides: createdOverrides,
  });
}

async function loadApprovalForAlwaysMode(
  msg: ProtocolRequestEnvelope,
  req: ApprovalResolveRequestPayload,
  tenantId: string,
  deps: ProtocolDeps,
): Promise<{ response: WsResponseEnvelope } | { existing: ApprovalRow }> {
  const existing = await deps.approvalDal!.getById({
    tenantId,
    approvalId: req.approval_id,
  });
  if (!existing) {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        `approval ${String(req.approval_id)} not found`,
      ),
    };
  }
  return { existing };
}

async function createPolicyOverrides(params: {
  tenantId: string;
  deps: ProtocolDeps;
  selectedOverrides: Array<{ tool_id: string; pattern: string; workspace_id?: string }>;
  createOverrideContext: { agentId: string; policySnapshotId?: string; approvalId: string };
}): Promise<unknown[]> {
  const { tenantId, deps, selectedOverrides, createOverrideContext } = params;
  const createdBy = { kind: "ws" };
  const createdOverrides: unknown[] = [];

  for (const selectedOverride of selectedOverrides) {
    const row = await deps.policyOverrideDal!.create({
      tenantId,
      agentId: createOverrideContext.agentId,
      workspaceId: selectedOverride.workspace_id,
      toolId: selectedOverride.tool_id,
      pattern: selectedOverride.pattern,
      createdBy,
      createdFromApprovalId: createOverrideContext.approvalId,
      createdFromPolicySnapshotId: createOverrideContext.policySnapshotId,
    });
    createdOverrides.push(row);
    const persistedEvent = await ensurePolicyOverrideCreatedEvent({
      tenantId,
      override: row,
      audience: APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE,
      wsEventDal: deps.wsEventDal,
    });
    broadcastEvent(tenantId, persistedEvent.event, deps, APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE);
  }

  return createdOverrides;
}
