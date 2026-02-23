/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import {
  descriptorIdForClientCapability,
  requiredCapability,
  ApprovalListRequest,
  ApprovalListResponse,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  parseTyrumKey,
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
  WsMessageEnvelope,
  WsTaskExecuteResult,
} from "@tyrum/schemas";
import type {
  ActionPrimitive,
  ClientCapability,
  Approval as ApprovalT,
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsResponseErrEnvelope,
} from "@tyrum/schemas";
import type { ConnectedClient } from "./connection-manager.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { ApprovalDal } from "../modules/approval/dal.js";
import { toApprovalContract } from "../modules/approval/to-contract.js";
import type { PresenceDal } from "../modules/presence/dal.js";
import type { ContextReportDal } from "../modules/context/report-dal.js";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";
import type { NodePairingDal } from "../modules/node/pairing-dal.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { PolicyService } from "../modules/policy/service.js";
import type { PluginRegistry } from "../modules/plugins/registry.js";
import type { Logger } from "../modules/observability/logger.js";
import type { SqlDb, StateStoreKind } from "../statestore/types.js";
import type { ModelsDevService } from "../modules/models/models-dev-service.js";
import { executeCommand } from "../modules/commands/dispatcher.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/**
 * External dependencies injected into the protocol handler so the module
 * stays unit-testable without real services.
 */
export interface ProtocolDeps {
  connectionManager: ConnectionManager;
  logger?: Logger;
  db?: SqlDb;
  contextReportDal?: ContextReportDal;
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
  };
  approvalDal?: ApprovalDal;
  presenceDal?: PresenceDal;
  policyOverrideDal?: PolicyOverrideDal;
  nodePairingDal?: NodePairingDal;
  agents?: AgentRegistry;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  plugins?: PluginRegistry;
  modelsDev?: ModelsDevService;
  presenceTtlMs?: number;

  /**
   * Optional cluster router. When configured, the gateway can deliver WS messages
   * to peers connected to other edge instances via the DB outbox + polling backplane.
   */
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
    connectionDirectory: ConnectionDirectoryDal;
  };

  /** Called when a task.execute response is received from a client. */
  onTaskResult?: (
    taskId: string,
    success: boolean,
    evidence: unknown,
    error: string | undefined,
  ) => void;

  /** Called when an approval.request response is received from a client. */
  onApprovalDecision?: (
    approvalId: number,
    approved: boolean,
    reason: string | undefined,
  ) => void;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class NoCapableClientError extends Error {
  constructor(public readonly capability: ClientCapability) {
    super(`no connected client with capability: ${capability}`);
    this.name = "NoCapableClientError";
  }
}

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
      const failureEvidence = !msg.ok
        ? evidenceFromErrorDetails(msg.error.details)
        : undefined;

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

      deps.onApprovalDecision?.(
        approvalId,
        decision.data.approved,
        decision.data.reason,
      );
      return undefined;
    }

    // Unknown response type — ignore.
    return undefined;
  }

  // Requests (client -> gateway). In the current runtime, we don't accept
  // post-handshake client requests via WS (use HTTP routes for now).
  if (msg.type === "approval.list") {
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
    }

    const req = ApprovalResolveRequest.parse(parsedReq.data.payload);

    let createdOverrides: unknown[] | undefined;
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
      if (!existing || existing.status !== "pending") {
        return errorResponse(
          msg.request_id,
          msg.type,
          "not_found",
          `approval ${String(req.approval_id)} not found or already responded`,
        );
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
      }

      const agentId = extractAgentId(existing.context) ?? "default";
      const snapshotId = extractPolicySnapshotId(existing.context);
      const createdBy = { kind: "ws" };

      createdOverrides = [];
      for (const sel of selected) {
        const row = await deps.policyOverrideDal.create({
          agentId,
          workspaceId: sel.workspace_id,
          toolId: sel.tool_id,
          pattern: sel.pattern,
          createdBy,
          createdFromApprovalId: existing.id,
          createdFromPolicySnapshotId: snapshotId,
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
          await deps.engine.cancelRun(updated.run_id, updated.response_reason ?? req.reason ?? "approval denied");
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

  if (msg.type === "pairing.approve" || msg.type === "pairing.deny" || msg.type === "pairing.revoke") {
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
    let pairing: unknown;

    if (msg.type === "pairing.approve") {
      const parsedReq = WsPairingApproveRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          parsedReq.error.message,
          { issues: parsedReq.error.issues },
        );
      }

      pairingId = parsedReq.data.payload.pairing_id;
      pairing = await deps.nodePairingDal.resolve({
        pairingId,
        decision: "approved",
        reason: parsedReq.data.payload.reason,
        resolvedBy,
        trustLevel: parsedReq.data.payload.trust_level,
        capabilityAllowlist: parsedReq.data.payload.capability_allowlist,
      });
    } else if (msg.type === "pairing.deny") {
      const parsedReq = WsPairingDenyRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          parsedReq.error.message,
          { issues: parsedReq.error.issues },
        );
      }

      pairingId = parsedReq.data.payload.pairing_id;
      pairing = await deps.nodePairingDal.resolve({
        pairingId,
        decision: "denied",
        reason: parsedReq.data.payload.reason,
        resolvedBy,
      });
    } else {
      const parsedReq = WsPairingRevokeRequest.safeParse(msg);
      if (!parsedReq.success) {
        return errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          parsedReq.error.message,
          { issues: parsedReq.error.issues },
        );
      }

      pairingId = parsedReq.data.payload.pairing_id;
      pairing = await deps.nodePairingDal.revoke({
        pairingId,
        reason: parsedReq.data.payload.reason,
        resolvedBy,
      });
    }

    if (!pairing) return notFound(pairingId);
    return ok(pairing);
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "agent_runtime_error",
        message,
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
    }

    const res = await executeCommand(parsedReq.data.payload.command, {
      runtime: deps.runtime,
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
    }
    try {
      const planId =
        parsedReq.data.payload.plan_id ?? `plan-${crypto.randomUUID()}`;
      const requestId =
        parsedReq.data.payload.request_id ?? `req-${crypto.randomUUID()}`;

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
      return errorResponse(
        msg.request_id,
        msg.type,
        "internal_error",
        message,
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
    }

    const runId = await deps.engine.resumeRun(parsedReq.data.payload.token);
    if (!runId) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        "resume token not found",
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
    }

    const outcome = await deps.engine.cancelRun(
      parsedReq.data.payload.run_id,
      parsedReq.data.payload.reason,
    );
    if (outcome === "not_found") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        "run not found",
      );
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
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        { issues: parsedReq.error.issues },
      );
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
      void deps.cluster.outboxDal.enqueue(
        "ws.broadcast",
        {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          message: evt,
        },
      ).catch(() => {
        // ignore
      });
    }

    const result = WsPresenceBeaconResult.parse({ entry });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  return errorResponse(
    msg.request_id,
    msg.type,
    "unsupported_request",
    "request not supported",
  );
}

// ---------------------------------------------------------------------------
// Gateway -> Client dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Find a capable client and send a `task_dispatch` message.
 *
 * @throws {NoCapableClientError} when no connected client has the required capability.
 * @returns the task_id assigned to the dispatched task.
 */
export function dispatchTask(
  action: ActionPrimitive,
  scope: { runId: string; stepId: string; attemptId: string },
  deps: ProtocolDeps,
): Promise<string> {
  const capability = requiredCapability(action.type);
  if (capability === undefined) {
    throw new NoCapableClientError(action.type as ClientCapability);
  }

  const descriptorId = descriptorIdForClientCapability(capability);
  const toolMatchTarget = `capability:${descriptorId};action:${action.type}`;
  const policyEnabled = deps.policyService?.isEnabled() ?? false;
  const policyEvalPromise = policyEnabled
    ? deps.policyService!.evaluateToolCall({
        agentId: "default",
        toolId: "tool.node.dispatch",
        toolMatchTarget,
      })
    : undefined;

  const localCandidates: ConnectedClient[] = [];
  for (const c of deps.connectionManager.allClients()) {
    if (c.protocol_rev >= 2 && c.capabilities.includes(capability)) {
      localCandidates.push(c);
    }
  }

  if (localCandidates.length === 0) {
    const cluster = deps.cluster;
    if (!cluster) {
      throw new NoCapableClientError(capability);
    }

    const nowMs = Date.now();
    return (async (): Promise<string> => {
      const policyEvaluation = policyEvalPromise
        ? await policyEvalPromise.catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            deps.logger?.error("policy.evaluate_failed", {
              tool_id: "tool.node.dispatch",
              tool_match_target: toolMatchTarget,
              error: message,
            });
            return { decision: "deny" as const, policy_snapshot: undefined };
          })
        : undefined;
      const policyDecision = policyEvaluation?.decision;
      const policySnapshotId = policyEvaluation?.policy_snapshot?.policy_snapshot_id;
      const shouldEnforcePolicy = policyEnabled && !(deps.policyService?.isObserveOnly() ?? false);
      const nodeDispatchAllowed = !shouldEnforcePolicy || policyDecision === "allow";
      const trace = policySnapshotId || policyDecision
        ? { policy_snapshot_id: policySnapshotId, policy_decision: policyDecision }
        : undefined;

      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        capability,
        nowMs,
      );

      const eligibleNodes = deps.nodePairingDal
        ? (
            await Promise.all(
              candidates
                .filter(
                  (c) =>
                    c.protocol_rev >= 2 &&
                    c.role === "node" &&
                    typeof c.device_id === "string" &&
                    c.device_id.trim().length > 0,
                )
                .map(async (c) => {
                  const pairing = await deps.nodePairingDal!.getByNodeId(c.device_id!);
                  if (!nodeDispatchAllowed) return null;
                  if (pairing?.status !== "approved") return null;
                  const allowlist = pairing.capability_allowlist ?? [];
                  return allowlist.some((entry) => entry.id === descriptorId) ? c : null;
                }),
            )
          ).filter((c): c is NonNullable<(typeof candidates)[number]> => c !== null)
        : [];

      const eligibleClients = candidates.filter((c) => c.protocol_rev >= 2 && c.role === "client");
      const eligible = [...eligibleNodes, ...eligibleClients];

      const target = eligible.find((c) => c.edge_id !== cluster.edgeId) ?? eligible[0];
      if (!target || target.edge_id === cluster.edgeId) {
        throw new NoCapableClientError(capability);
      }

      const requestId = `task-${crypto.randomUUID()}`;
      const message: WsRequestEnvelope = {
        request_id: requestId,
        type: "task.execute",
        payload: {
          run_id: scope.runId,
          step_id: scope.stepId,
          attempt_id: scope.attemptId,
          action,
        },
        trace: target.role === "node" ? trace : undefined,
      };

      await cluster.outboxDal.enqueue(
        "ws.direct",
        { connection_id: target.connection_id, message },
        { targetEdgeId: target.edge_id },
      );
      return requestId;
    })();
  }

  return (async (): Promise<string> => {
    const policyEvaluation = policyEvalPromise
      ? await policyEvalPromise.catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          deps.logger?.error("policy.evaluate_failed", {
            tool_id: "tool.node.dispatch",
            tool_match_target: toolMatchTarget,
            error: message,
          });
          return { decision: "deny" as const, policy_snapshot: undefined };
        })
      : undefined;
    const policyDecision = policyEvaluation?.decision;
    const policySnapshotId = policyEvaluation?.policy_snapshot?.policy_snapshot_id;
    const shouldEnforcePolicy = policyEnabled && !(deps.policyService?.isObserveOnly() ?? false);
    const nodeDispatchAllowed = !shouldEnforcePolicy || policyDecision === "allow";
    const trace = policySnapshotId || policyDecision
      ? { policy_snapshot_id: policySnapshotId, policy_decision: policyDecision }
      : undefined;

    const eligibleNodes: ConnectedClient[] = [];
    const eligibleClients: ConnectedClient[] = [];

    for (const c of localCandidates) {
      if (c.role !== "node") {
        eligibleClients.push(c);
        continue;
      }

      const nodeId = c.device_id;
      if (!nodeId || !deps.nodePairingDal) continue;
      const pairing = await deps.nodePairingDal.getByNodeId(nodeId);
      if (!nodeDispatchAllowed) continue;
      if (pairing?.status !== "approved") continue;
      const allowlist = pairing.capability_allowlist ?? [];
      if (!allowlist.some((entry) => entry.id === descriptorId)) continue;
      {
        eligibleNodes.push(c);
      }
    }

    const selected = eligibleNodes[0] ?? eligibleClients[0];
    if (!selected) {
      const cluster = deps.cluster;
      if (!cluster) {
        throw new NoCapableClientError(capability);
      }

      const nowMs = Date.now();
      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        capability,
        nowMs,
      );

      const eligibleNodes2 = deps.nodePairingDal
        ? (
            await Promise.all(
              candidates
                .filter(
                  (c) =>
                    c.protocol_rev >= 2 &&
                    c.role === "node" &&
                    typeof c.device_id === "string" &&
                    c.device_id.trim().length > 0,
                )
                .map(async (c) => {
                  const pairing = await deps.nodePairingDal!.getByNodeId(c.device_id!);
                  if (!nodeDispatchAllowed) return null;
                  if (pairing?.status !== "approved") return null;
                  const allowlist = pairing.capability_allowlist ?? [];
                  return allowlist.some((entry) => entry.id === descriptorId) ? c : null;
                }),
            )
          ).filter((c): c is NonNullable<(typeof candidates)[number]> => c !== null)
        : [];
      const eligibleClients2 = candidates.filter((c) => c.protocol_rev >= 2 && c.role === "client");
      const eligible2 = [...eligibleNodes2, ...eligibleClients2];

      const target = eligible2.find((c) => c.edge_id !== cluster.edgeId) ?? eligible2[0];
      if (!target || target.edge_id === cluster.edgeId) {
        throw new NoCapableClientError(capability);
      }

      const requestId = `task-${crypto.randomUUID()}`;
      const message: WsRequestEnvelope = {
        request_id: requestId,
        type: "task.execute",
        payload: {
          run_id: scope.runId,
          step_id: scope.stepId,
          attempt_id: scope.attemptId,
          action,
        },
        trace: target.role === "node" ? trace : undefined,
      };

      await cluster.outboxDal.enqueue(
        "ws.direct",
        { connection_id: target.connection_id, message },
        { targetEdgeId: target.edge_id },
      );
      return requestId;
    }

    const requestId = `task-${crypto.randomUUID()}`;
    const message: WsRequestEnvelope = {
      request_id: requestId,
      type: "task.execute",
      payload: {
        run_id: scope.runId,
        step_id: scope.stepId,
        attempt_id: scope.attemptId,
        action,
      },
      trace: selected.role === "node" ? trace : undefined,
    };
    selected.ws.send(JSON.stringify(message));
    return requestId;
  })();
}

/**
 * Send an approval.request to the first connected client.
 *
 * Approval requests are not capability-scoped; any connected client
 * with a human operator can respond.
 */
export function requestApproval(
  approval: {
    approval_id: number;
    plan_id: string;
    step_index: number;
    prompt: string;
    context?: unknown;
    expires_at?: string | null;
  },
  deps: ProtocolDeps,
): void {
  const requestId = `approval-${String(approval.approval_id)}`;
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "approval.request",
    payload: approval,
  };
  const payload = JSON.stringify(message);

  // Send to the first available client.
  const iter = deps.connectionManager.allClients();
  const first = iter.next();
  if (!first.done) {
    first.value.ws.send(payload);
    if (deps.cluster) {
      void deps.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          message,
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          deps.logger?.error("outbox.enqueue_failed", {
            topic: "ws.broadcast",
            error: message,
          });
        });
    }
    return;
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", { message })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("outbox.enqueue_failed", {
          topic: "ws.broadcast",
          error: message,
        });
      });
  }
}

/**
 * Broadcast a `plan_update` to all connected clients.
 */
export function sendPlanUpdate(
  planId: string,
  status: string,
  deps: ProtocolDeps,
  detail?: string,
): void {
  const message: WsEventEnvelope = {
    event_id: crypto.randomUUID(),
    type: "plan.update",
    occurred_at: new Date().toISOString(),
    payload: {
      plan_id: planId,
      status,
      detail,
    },
  };
  const payload = JSON.stringify(message);

  for (const client of deps.connectionManager.allClients()) {
    client.ws.send(payload);
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        message,
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("outbox.enqueue_failed", {
          topic: "ws.broadcast",
          error: message,
        });
      });
  }
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

function extractSuggestedOverrides(approvalContext: unknown): Array<{ tool_id: string; pattern: string; workspace_id?: string }> {
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
