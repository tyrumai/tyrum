/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import {
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  WsApprovalDecision,
  WsError,
  WsApprovalListRequest,
  WsApprovalResolveRequest,
  WsSessionSendRequest,
  WsSessionSendResult,
  WsCommandExecuteRequest,
  WsCommandExecuteResult,
  WsWorkflowRunRequest,
  WsWorkflowRunResult,
  WsWorkflowResumeRequest,
  WsWorkflowResumeResult,
  WsWorkflowCancelRequest,
  WsWorkflowCancelResult,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsPairingRevokeRequest,
  WsPairingResolveResult,
  WsPresenceBeaconRequest,
  WsPresenceBeaconResult,
  WsCapabilityReadyRequest,
  WsAttemptEvidenceRequest,
  WsMessageEnvelope,
  WsTaskExecuteResult,
  clientCapabilityFromDescriptorId,
  parseTyrumKey,
} from "@tyrum/schemas";
import type {
  Approval as ApprovalT,
  ClientCapability,
  NodePairingRequest as NodePairingRequestT,
  WsEventEnvelope,
  WsResponseEnvelope,
  WsResponseErrEnvelope,
} from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { emitPairingApprovedEvent } from "../pairing-approved.js";
import { toApprovalContract } from "../../modules/approval/to-contract.js";
import { executeCommand } from "../../modules/commands/dispatcher.js";
import { hasAnyRequiredScope } from "../../modules/auth/scopes.js";
import { resolveWsRequestRequiredScopes } from "../../modules/authz/ws-scope-matrix.js";
import { isSafeSuggestedOverridePattern } from "../../modules/policy/override-guardrails.js";
import type { ProtocolDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Client message handling
// ---------------------------------------------------------------------------

/**
 * Parse and dispatch a raw WebSocket message from a connected client.
 *
 * @returns an error message to send back, or `undefined` on success.
 */
export async function handleClientMessage(
  client: ConnectedClient,
  raw: string,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | WsEventEnvelope | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return errorEvent("invalid_json", "message is not valid JSON");
  }

  const parsed = WsMessageEnvelope.safeParse(json);
  if (!parsed.success) {
    return errorEvent("invalid_message", parsed.error.message);
  }

  const msg = parsed.data;

  // Events are gateway-emitted; reject client-sent events.
  if ("event_id" in msg) {
    return errorEvent("unexpected_event", "clients must not send events");
  }

  // Responses (client -> gateway)
  if ("ok" in msg) {
    if (msg.type === "ping" && msg.ok === true) {
      client.lastPong = Date.now();
      return undefined;
    }

    if (msg.type === "task.execute") {
      const evidenceAndResult = msg.ok
        ? WsTaskExecuteResult.safeParse(msg.result ?? {})
        : undefined;
      const failureEvidence = !msg.ok ? evidenceFromErrorDetails(msg.error.details) : undefined;

      deps.onTaskResult?.(
        msg.request_id,
        msg.ok,
        msg.ok
          ? evidenceAndResult?.success
            ? evidenceAndResult.data.evidence
            : undefined
          : failureEvidence,
        msg.ok ? undefined : msg.error.message,
      );
      return undefined;
    }

    if (msg.type === "approval.request") {
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

      deps.onApprovalDecision?.(approvalId, decision.data.approved, decision.data.reason);
      return undefined;
    }

    // Unknown response type — ignore.
    return undefined;
  }

  // Requests (peer -> gateway) — WS control-plane operations.
  const authClaims = client.auth_claims;
  if (!authClaims) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "missing auth claims");
  }

  if (authClaims.token_kind === "device") {
    const requiredScopes = resolveWsRequestRequiredScopes(msg.type);
    if (!requiredScopes) {
      await deps.authAudit?.recordAuthzDenied({
        surface: "ws",
        reason: "not_scope_authorized",
        token: {
          token_kind: authClaims.token_kind,
          token_id: authClaims.token_id,
          device_id: authClaims.device_id,
          role: authClaims.role,
          scopes: authClaims.scopes,
        },
        required_scopes: null,
        request_type: msg.type,
        request_id: msg.request_id,
        client_id: client.id,
      });
      return errorResponse(
        msg.request_id,
        msg.type,
        "forbidden",
        "request is not scope-authorized for scoped tokens",
      );
    }

    if (!hasAnyRequiredScope(authClaims, requiredScopes)) {
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
        required_scopes: requiredScopes,
        request_type: msg.type,
        request_id: msg.request_id,
        client_id: client.id,
      });
      return errorResponse(msg.request_id, msg.type, "forbidden", "insufficient scope");
    }
  }

  if (msg.type === "approval.list") {
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
        ? await deps.approvalDal.getPending()
        : status === "cancelled"
          ? []
          : await deps.approvalDal.getByStatus(status);

    const approvals = rows
      .map(toApprovalContract)
      .filter((a): a is ApprovalT => Boolean(a))
      .filter((a) => {
        if (filter.kind && filter.kind.length > 0 && !filter.kind.includes(a.kind)) {
          return false;
        }
        if (filter.key && a.scope?.key !== filter.key) return false;
        if (filter.lane && a.scope?.lane !== filter.lane) return false;
        if (filter.run_id && a.scope?.run_id !== filter.run_id) return false;
        return true;
      })
      .slice(0, limit);
    const result = ApprovalListResponse.parse({ approvals, next_cursor: undefined });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  if (msg.type === "approval.resolve") {
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

    let selectedOverrides:
      | Array<{ tool_id: string; pattern: string; workspace_id?: string }>
      | undefined;
    let createOverrideContext:
      | { agentId: string; policySnapshotId?: string; approvalId: number }
      | undefined;

    if (req.decision === "approved" && req.mode === "always") {
      if (!deps.policyOverrideDal) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "unsupported_request",
          "policy overrides not supported",
        );
      }

      const existing = await deps.approvalDal.getById(req.approval_id);
      if (!existing) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "not_found",
          `approval ${String(req.approval_id)} not found`,
        );
      }
      if (existing.status !== "pending") {
        const approval = toApprovalContract(existing);
        if (!approval) {
          return errorResponse(
            msg.request_id,
            msg.type,
            "invalid_state",
            `approval ${String(existing.id)} could not be converted to contract`,
          );
        }
        const result = ApprovalResolveResponse.parse({ approval });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      }

      const suggested = extractSuggestedOverrides(existing.context);
      const selected = Array.isArray(req.overrides) ? req.overrides : [];
      if (selected.length === 0) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          "mode=always requires selecting overrides",
        );
      }

      const allowed = new Set(
        suggested.map((s) => `${s.tool_id}::${s.pattern}::${s.workspace_id ?? ""}`),
      );
      for (const sel of selected) {
        const key = `${sel.tool_id}::${sel.pattern}::${sel.workspace_id ?? ""}`;
        if (!allowed.has(key)) {
          return errorResponse(
            msg.request_id,
            msg.type,
            "invalid_request",
            "requested overrides must be selected from suggested_overrides",
          );
        }
        if (!isSafeSuggestedOverridePattern(sel.pattern)) {
          return errorResponse(
            msg.request_id,
            msg.type,
            "invalid_request",
            "requested overrides violate deny guardrails",
          );
        }
      }

      selectedOverrides = selected;
      createOverrideContext = {
        agentId: extractAgentId(existing.context) ?? "default",
        policySnapshotId: extractPolicySnapshotId(existing.context),
        approvalId: existing.id,
      };
    }

    const updated = await deps.approvalDal.respond(
      req.approval_id,
      req.decision === "approved",
      req.reason,
    );
    if (!updated) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        `approval ${String(req.approval_id)} not found`,
      );
    }

    const desiredStatus = req.decision === "approved" ? "approved" : "denied";
    const decisionMatches = updated.status === desiredStatus;
    if (updated.status !== desiredStatus) {
      deps.logger?.warn("approval.decision_mismatch", {
        approval_id: updated.id,
        decision: req.decision,
        status: updated.status,
      });
    } else if (deps.engine) {
      try {
        if (updated.status === "approved" && updated.resume_token) {
          await deps.engine.resumeRun(updated.resume_token);
        } else if (updated.status === "denied" && updated.run_id) {
          await deps.engine.cancelRun(
            updated.run_id,
            updated.response_reason ?? req.reason ?? "approval denied",
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("approval.engine_action_failed", {
          approval_id: updated.id,
          decision: req.decision,
          run_id: updated.run_id,
          error: message,
        });
      }
    }

    let createdOverrides: unknown[] | undefined;
    if (
      decisionMatches &&
      updated.status === "approved" &&
      req.mode === "always" &&
      selectedOverrides &&
      createOverrideContext
    ) {
      const createdBy = { kind: "ws" };
      createdOverrides = [];

      for (const sel of selectedOverrides) {
        const row = await deps.policyOverrideDal!.create({
          agentId: createOverrideContext.agentId,
          workspaceId: sel.workspace_id,
          toolId: sel.tool_id,
          pattern: sel.pattern,
          createdBy,
          createdFromApprovalId: createOverrideContext.approvalId,
          createdFromPolicySnapshotId: createOverrideContext.policySnapshotId,
        });
        createdOverrides.push(row);
        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "policy_override.created",
            occurred_at: new Date().toISOString(),
            payload: { override: row },
          },
          deps,
        );
      }
    }

    const approval = toApprovalContract(updated);
    if (!approval) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_state",
        `approval ${String(updated.id)} could not be converted to contract`,
      );
    }
    const result = ApprovalResolveResponse.parse({
      approval,
      created_overrides: createdOverrides,
    });

    broadcastEvent(
      {
        event_id: crypto.randomUUID(),
        type: "approval.resolved",
        occurred_at: new Date().toISOString(),
        payload: { approval },
      },
      deps,
    );
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  if (
    msg.type === "pairing.approve" ||
    msg.type === "pairing.deny" ||
    msg.type === "pairing.revoke"
  ) {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may resolve pairings",
      );
    }
    if (!deps.nodePairingDal) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "pairing resolution not supported",
      );
    }

    const resolvedBy = {
      kind: "ws",
      client_id: client.id,
      device_id: client.device_id,
    };

    const notFound = (pairingId: number) =>
      errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        `pairing ${String(pairingId)} not found or not resolvable`,
      );

    const ok = (pairing: unknown): WsResponseEnvelope => {
      broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "pairing.resolved",
          occurred_at: new Date().toISOString(),
          payload: { pairing },
        },
        deps,
      );

      const result = WsPairingResolveResult.parse({ pairing });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    };

    let pairingId: number;
    let pairing: NodePairingRequestT | undefined;
    let scopedToken: string | undefined;

    if (msg.type === "pairing.approve") {
      const parsedReq = WsPairingApproveRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      pairingId = parsedReq.data.payload.pairing_id;
      const resolved = await deps.nodePairingDal.resolve({
        pairingId,
        decision: "approved",
        reason: parsedReq.data.payload.reason,
        resolvedBy,
        trustLevel: parsedReq.data.payload.trust_level,
        capabilityAllowlist: parsedReq.data.payload.capability_allowlist,
      });
      pairing = resolved?.pairing;
      scopedToken = resolved?.scopedToken;
    } else if (msg.type === "pairing.deny") {
      const parsedReq = WsPairingDenyRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      pairingId = parsedReq.data.payload.pairing_id;
      const resolved = await deps.nodePairingDal.resolve({
        pairingId,
        decision: "denied",
        reason: parsedReq.data.payload.reason,
        resolvedBy,
      });
      pairing = resolved?.pairing;
    } else {
      const parsedReq = WsPairingRevokeRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
          issues: parsedReq.error.issues,
        });
      }

      pairingId = parsedReq.data.payload.pairing_id;
      pairing = await deps.nodePairingDal.revoke({
        pairingId,
        reason: parsedReq.data.payload.reason,
        resolvedBy,
      });
    }

    if (!pairing) return notFound(pairingId);

    if (msg.type === "pairing.approve" && scopedToken) {
      emitPairingApprovedEvent(deps, { pairing, nodeId: pairing.node.node_id, scopedToken });
    }
    return ok(pairing);
  }

  if (msg.type === "capability.ready") {
    if (client.role !== "node") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only nodes may report capability readiness",
      );
    }

    const parsedReq = WsCapabilityReadyRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const readyLegacyCaps = parsedReq.data.payload.capabilities
      .map((capability) => clientCapabilityFromDescriptorId(capability.id))
      .filter((capability): capability is ClientCapability => capability !== undefined)
      .filter((capability) => client.capabilities.includes(capability));

    deps.connectionManager.setReadyCapabilities(client.id, readyLegacyCaps);

    if (deps.cluster) {
      void deps.cluster.connectionDirectory
        .setReadyCapabilities({
          connectionId: client.id,
          readyCapabilities: [...client.readyCapabilities].sort(),
        })
        .catch(() => {
          // ignore readiness persistence failures (best-effort)
        });
    }

    const nodeId = client.device_id ?? client.id;
    broadcastEvent(
      {
        event_id: crypto.randomUUID(),
        type: "capability.ready",
        occurred_at: new Date().toISOString(),
        scope: { kind: "node", node_id: nodeId },
        payload: {
          node_id: nodeId,
          capabilities: parsedReq.data.payload.capabilities,
        },
      },
      deps,
    );

    return { request_id: msg.request_id, type: msg.type, ok: true };
  }

  if (msg.type === "attempt.evidence") {
    if (client.role !== "node") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only nodes may report attempt evidence",
      );
    }

    const maxAttemptEvidenceChars = 256 * 1024;
    if (raw.length > maxAttemptEvidenceChars) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        "attempt evidence payload too large",
        { max_chars: maxAttemptEvidenceChars, actual_chars: raw.length },
      );
    }

    const parsedReq = WsAttemptEvidenceRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const nodeId = client.device_id ?? client.id;
    const payload = parsedReq.data.payload;

    if (!deps.nodePairingDal) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "attempt evidence not supported",
      );
    }
    const pairing = await deps.nodePairingDal.getByNodeId(nodeId).catch(() => undefined);
    if (pairing?.status !== "approved") {
      return errorResponse(msg.request_id, msg.type, "unauthorized", "node is not paired");
    }

    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "attempt evidence not supported",
      );
    }

    const attempt = await deps.db.get<{
      run_id: string;
      step_id: string;
      status: string;
      metadata_json: string | null;
    }>(
      `SELECT
         s.run_id AS run_id,
         a.step_id AS step_id,
         a.status AS status,
         a.metadata_json AS metadata_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE a.attempt_id = ?`,
      [payload.attempt_id],
    );
    if (!attempt) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", "unknown attempt_id");
    }

    if (attempt.run_id !== payload.run_id || attempt.step_id !== payload.step_id) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", "attempt scope mismatch");
    }

    if (attempt.status !== "running") {
      return errorResponse(msg.request_id, msg.type, "invalid_state", "attempt is not running", {
        status: attempt.status,
      });
    }

    let dispatchedNodeId: string | undefined;
    if (typeof attempt.metadata_json === "string" && attempt.metadata_json.trim().length > 0) {
      try {
        const meta = JSON.parse(attempt.metadata_json) as unknown;
        if (isObject(meta)) {
          const executor = meta["executor"];
          if (isObject(executor) && executor["kind"] === "node") {
            const executorNodeId = executor["node_id"];
            dispatchedNodeId =
              typeof executorNodeId === "string" && executorNodeId.trim().length > 0
                ? executorNodeId
                : undefined;
          }
        }
      } catch {
        // ignore malformed metadata_json
      }
    }

    if (!dispatchedNodeId) {
      dispatchedNodeId = deps.connectionManager.getDispatchedAttemptExecutor(payload.attempt_id);
      if (!dispatchedNodeId) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_state",
          "attempt executor metadata missing; evidence cannot be authorized",
        );
      }
    }

    if (dispatchedNodeId !== nodeId) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "node is not the dispatched executor for this attempt",
      );
    }

    broadcastEvent(
      {
        event_id: crypto.randomUUID(),
        type: "attempt.evidence",
        occurred_at: new Date().toISOString(),
        scope: { kind: "run", run_id: payload.run_id },
        payload: {
          node_id: nodeId,
          run_id: payload.run_id,
          step_id: payload.step_id,
          attempt_id: payload.attempt_id,
          evidence: payload.evidence,
        },
      },
      deps,
    );

    return { request_id: msg.request_id, type: msg.type, ok: true };
  }

  if (msg.type === "session.send") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may send session messages",
      );
    }
    if (!deps.agents) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "session.send not supported",
      );
    }
    const parsedReq = WsSessionSendRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    try {
      const agentId = parsedReq.data.payload.agent_id ?? "default";
      const runtime = await deps.agents.getRuntime(agentId);
      const res = await runtime.turn({
        channel: parsedReq.data.payload.channel,
        thread_id: parsedReq.data.payload.thread_id,
        message: parsedReq.data.payload.content,
        metadata: { source: "ws", request_id: msg.request_id },
      });
      const result = WsSessionSendResult.parse({
        session_id: res.session_id,
        assistant_message: res.reply,
      });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(msg.request_id, msg.type, "agent_runtime_error", message);
    }
  }

  if (msg.type === "command.execute") {
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

    const res = await executeCommand(parsedReq.data.payload.command, {
      runtime: deps.runtime,
      commandContext: {
        agentId: parsedReq.data.payload.agent_id,
        channel: parsedReq.data.payload.channel,
        threadId: parsedReq.data.payload.thread_id,
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
      modelsDev: deps.modelsDev,
      agents: deps.agents,
    });

    if (deps.hooks) {
      void deps.hooks
        .fire({
          event: "command.execute",
          metadata: { command: parsedReq.data.payload.command },
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          deps.logger?.warn("hooks.fire_failed", {
            event: "command.execute",
            error: message,
          });
        });
    }

    const result = WsCommandExecuteResult.parse({
      output: res.output,
      data: res.data,
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  if (msg.type === "workflow.run") {
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
    try {
      const planId = parsedReq.data.payload.plan_id ?? `plan-${crypto.randomUUID()}`;
      const requestId = parsedReq.data.payload.request_id ?? `req-${crypto.randomUUID()}`;

      const keyParsed = parseTyrumKey(parsedReq.data.payload.key);
      const agentId = keyParsed.kind === "agent" ? keyParsed.agent_id : "default";
      const policy = deps.agents ? deps.agents.getPolicyService(agentId) : deps.policyService!;
      const effectivePolicy = await policy.loadEffectiveBundle();
      const snapshot = await policy.getOrCreateSnapshot(effectivePolicy.bundle);

      const res = await deps.engine.enqueuePlan({
        key: parsedReq.data.payload.key,
        lane: parsedReq.data.payload.lane,
        planId,
        requestId,
        steps: parsedReq.data.payload.steps,
        policySnapshotId: snapshot.policy_snapshot_id,
        budgets: parsedReq.data.payload.budgets,
      });

      const result = WsWorkflowRunResult.parse({
        job_id: res.jobId,
        run_id: res.runId,
        plan_id: planId,
        request_id: requestId,
        key: parsedReq.data.payload.key,
        lane: parsedReq.data.payload.lane,
        steps_count: parsedReq.data.payload.steps.length,
      });

      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(msg.request_id, msg.type, "internal_error", message);
    }
  }

  if (msg.type === "workflow.resume") {
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

  if (msg.type === "workflow.cancel") {
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

  if (msg.type === "presence.beacon") {
    if (!deps.presenceDal || !client.device_id) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "presence.beacon not supported",
      );
    }
    const parsedReq = WsPresenceBeaconRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const nowMs = Date.now();
    const ttlMs = deps.presenceTtlMs ?? 60_000;
    const row = await deps.presenceDal.upsert({
      instanceId: client.device_id,
      role: client.role,
      connectionId: client.id,
      host: parsedReq.data.payload.host ?? null,
      ip: parsedReq.data.payload.ip ?? null,
      version: parsedReq.data.payload.version ?? null,
      mode: parsedReq.data.payload.mode ?? null,
      lastInputSeconds: parsedReq.data.payload.last_input_seconds ?? null,
      metadata: parsedReq.data.payload.metadata ?? {},
      nowMs,
      ttlMs,
    });

    const entry = {
      instance_id: row.instance_id,
      role: row.role,
      host: row.host ?? undefined,
      ip: row.ip ?? undefined,
      version: row.version ?? undefined,
      mode: (row.mode ?? undefined) as string | undefined,
      last_seen_at: new Date(row.last_seen_at_ms).toISOString(),
      last_input_seconds: row.last_input_seconds ?? undefined,
      reason: "periodic" as const,
      metadata: row.metadata,
    };

    // Broadcast best-effort presence update.
    const evt = {
      event_id: crypto.randomUUID(),
      type: "presence.upserted",
      occurred_at: new Date().toISOString(),
      payload: { entry },
    } satisfies WsEventEnvelope;

    for (const peer of deps.connectionManager.allClients()) {
      try {
        peer.ws.send(JSON.stringify(evt));
      } catch {
        // ignore
      }
    }
    if (deps.cluster) {
      void deps.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          message: evt,
        })
        .catch(() => {
          // ignore
        });
    }

    const result = WsPresenceBeaconResult.parse({ entry });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  return errorResponse(msg.request_id, msg.type, "unsupported_request", "request not supported");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorEvent(code: string, message: string): WsEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    type: "error",
    occurred_at: new Date().toISOString(),
    payload: { code, message },
  };
}

function errorResponse(
  requestId: string,
  type: string,
  code: string,
  message: string,
  details?: unknown,
): WsResponseErrEnvelope {
  const error = WsError.parse({ code, message, details });
  return { request_id: requestId, type, ok: false, error };
}

function parseApprovalId(requestId: string): number | undefined {
  // request_id is `approval-<approval_id>`
  if (!requestId.startsWith("approval-")) return undefined;
  const raw = requestId.slice("approval-".length);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function broadcastEvent(evt: WsEventEnvelope, deps: ProtocolDeps): void {
  const payload = JSON.stringify(evt);
  for (const peer of deps.connectionManager.allClients()) {
    try {
      peer.ws.send(payload);
    } catch {
      // ignore
    }
  }
  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        message: evt,
      })
      .catch(() => {
        // ignore
      });
  }
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

  const out: Array<{ tool_id: string; pattern: string; workspace_id?: string }> = [];
  for (const entry of suggested) {
    if (!isObject(entry)) continue;
    const toolId = entry["tool_id"];
    const pattern = entry["pattern"];
    const workspaceId = entry["workspace_id"];
    if (typeof toolId === "string" && typeof pattern === "string") {
      out.push({
        tool_id: toolId,
        pattern,
        workspace_id: typeof workspaceId === "string" ? workspaceId : undefined,
      });
    }
  }
  return out;
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

function evidenceFromErrorDetails(details: unknown): unknown {
  if (details === null || typeof details !== "object") {
    return undefined;
  }
  return (details as { evidence?: unknown }).evidence;
}
