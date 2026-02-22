/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import {
  PlaybookManifest,
  requiredCapability,
  WsApprovalDecision,
  WsError,
  WsApprovalListRequest,
  WsApprovalListResult,
  WsApprovalResolveRequest,
  WsApprovalResolveResult,
  WsMessageEnvelope,
  WsPresenceBeaconRequest,
  WsSessionSendRequest,
  WsSessionSendResult,
  WsTaskExecuteResult,
  WsWorkflowRunRequest,
  WsWorkflowRunResult,
  WsWorkflowCancelRequest,
  WsWorkflowCancelResult,
  WsWorkflowResumeRequest,
  WsWorkflowResumeResult,
  WsPairingApproveRequest,
  WsPairingApproveResult,
  WsPairingDenyRequest,
  WsPairingDenyResult,
  WsPairingRevokeRequest,
  WsPairingRevokeResult,
} from "@tyrum/schemas";
import type {
  ActionPrimitive,
  ClientCapability,
  ExecutionAttemptId,
  ExecutionRunId,
  ExecutionStepId,
  Approval as ApprovalT,
  ApprovalKind as ApprovalKindT,
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsResponseErrEnvelope,
} from "@tyrum/schemas";
import { parse as parseYaml } from "yaml";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, join as joinPath } from "node:path";
import type { ConnectedClient } from "./connection-manager.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { ApprovalDal, ApprovalStatus as ApprovalStatusT } from "../modules/approval/dal.js";
import { resolveAndApplyApproval } from "../modules/approval/apply.js";
import { toSchemaApproval } from "../modules/approval/schema.js";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { NodePairingService } from "../modules/node/pairing-service.js";
import type { NodeTokenDal } from "../modules/node/token-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { PresenceService } from "../modules/presence/service.js";
import type { AgentRuntime } from "../modules/agent/runtime.js";
import { PlaybookRunner } from "../modules/playbook/runner.js";

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
  presence?: PresenceService;

  /** Optional agent runtime for interactive chat requests. Enables session.send. */
  agentRuntime?: Pick<AgentRuntime, "turn">;

  /** Optional approval queue data access. Enables approval.list + approval.resolve. */
  approvalDal?: ApprovalDal;

  /** Optional workflow control surface. Enables workflow.run + workflow.resume + workflow.cancel. */
  executionEngine?: Pick<
    ExecutionEngine,
    "enqueuePlan" | "resumeRun" | "cancelRunByResumeToken" | "cancelRun"
  >;

  /** Optional node pairing service. Enables pairing.approve + pairing.deny. */
  nodePairingService?: NodePairingService;

  /** Optional node token DAL. Enables pairing.revoke invalidation. */
  nodeTokenDal?: Pick<NodeTokenDal, "revokeAllForNode">;

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
export function handleClientMessage(
  client: ConnectedClient,
  raw: string,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | WsEventEnvelope | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Promise.resolve(errorEvent("invalid_json", "message is not valid JSON"));
  }

  const parsed = WsMessageEnvelope.safeParse(json);
  if (!parsed.success) {
    return Promise.resolve(errorEvent("invalid_message", parsed.error.message));
  }

  const msg = parsed.data;

  // Events are gateway-emitted; reject client-sent events.
  if ("event_id" in msg) {
    return Promise.resolve(errorEvent("unexpected_event", "clients must not send events"));
  }

  // Responses (client -> gateway)
  if ("ok" in msg) {
    if (msg.type === "ping" && msg.ok === true) {
      client.lastPong = Date.now();
      return deps.presence
        ? deps.presence
            .touchFromHeartbeat(client)
            .then(() => undefined)
            .catch(() => undefined)
        : Promise.resolve(undefined);
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
      return Promise.resolve(undefined);
    }

    if (msg.type === "approval.request") {
      const approvalId = parseApprovalId(msg.request_id);
      if (approvalId === undefined) {
        return Promise.resolve(
          errorEvent(
            "invalid_approval_request_id",
            "approval response missing or invalid approval request id",
          ),
        );
      }

      if (!msg.ok) {
        return Promise.resolve(
          errorEvent(
            "approval_request_failed",
            `client error for ${msg.request_id} (${msg.error.code}): ${msg.error.message}`,
          ),
        );
      }

      const decision = WsApprovalDecision.safeParse(msg.result ?? {});
      if (!decision.success) {
        return Promise.resolve(
          errorEvent(
            "invalid_approval_decision",
            `invalid approval decision for ${msg.request_id}: ${decision.error.message}`,
          ),
        );
      }

      deps.onApprovalDecision?.(
        approvalId,
        decision.data.approved,
        decision.data.reason,
      );
      return Promise.resolve(undefined);
    }

    // Unknown response type — ignore.
    return Promise.resolve(undefined);
  }

  // Requests (client -> gateway)
  if (msg.type === "session.send") {
    const req = WsSessionSendRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may send session messages"),
      );
    }
    if (!deps.agentRuntime) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "agent runtime not enabled"),
      );
    }

    return deps.agentRuntime
      .turn({
        channel: req.data.payload.channel,
        thread_id: req.data.payload.thread_id,
        message: req.data.payload.message,
        metadata: req.data.payload.metadata,
      })
      .then((result) => {
        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsSessionSendResult.parse(result),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "workflow.run") {
    const req = WsWorkflowRunRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may start workflows"),
      );
    }
    if (!deps.executionEngine) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "workflow execution not enabled"),
      );
    }

    return compileWorkflow(req.data.payload.pipeline)
      .then(({ playbookId, steps }) => {
        const planId = `wf-${req.data.request_id}`;
        return deps.executionEngine!
          .enqueuePlan({
            key: req.data.payload.key,
            lane: req.data.payload.lane,
            planId,
            requestId: req.data.request_id,
            playbookId,
            provenanceSources: ["user"],
            steps,
          })
          .then(({ jobId, runId }) => {
            return {
              request_id: req.data.request_id,
              type: req.data.type,
              ok: true,
              result: WsWorkflowRunResult.parse({ job_id: jobId, run_id: runId, plan_id: planId }),
            } satisfies WsResponseEnvelope;
          });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "pairing.approve") {
    const req = WsPairingApproveRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may approve pairings"),
      );
    }
    if (!deps.nodePairingService) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "node pairing not enabled"),
      );
    }

    return deps.nodePairingService
      .resolve({
        nodeId: req.data.payload.node_id,
        decision: "approved",
        reason: req.data.payload.reason,
        resolvedBy: { instance_id: client.instance_id },
      })
      .then((pairing) => {
        if (!pairing) {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "pairing request not found");
        }

        // Force reconnect so approved nodes re-handshake with effective capabilities.
        closeNodeConnections(req.data.payload.node_id, deps);

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "pairing.resolved",
            occurred_at: new Date().toISOString(),
            payload: { pairing },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsPairingApproveResult.parse({ pairing }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "pairing.deny") {
    const req = WsPairingDenyRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may deny pairings"),
      );
    }
    if (!deps.nodePairingService) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "node pairing not enabled"),
      );
    }

    return deps.nodePairingService
      .resolve({
        nodeId: req.data.payload.node_id,
        decision: "denied",
        reason: req.data.payload.reason,
        resolvedBy: { instance_id: client.instance_id },
      })
      .then((pairing) => {
        if (!pairing) {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "pairing request not found");
        }

        closeNodeConnections(req.data.payload.node_id, deps);

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "pairing.resolved",
            occurred_at: new Date().toISOString(),
            payload: { pairing },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsPairingDenyResult.parse({ pairing }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "pairing.revoke") {
    const req = WsPairingRevokeRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may revoke pairings"),
      );
    }
    if (!deps.nodePairingService) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "node pairing not enabled"),
      );
    }

    return deps.nodePairingService
      .resolve({
        nodeId: req.data.payload.node_id,
        decision: "revoked",
        reason: req.data.payload.reason,
        resolvedBy: { instance_id: client.instance_id },
      })
      .then(async (pairing) => {
        if (!pairing) {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "pairing request not found");
        }

        if (deps.nodeTokenDal) {
          await deps.nodeTokenDal
            .revokeAllForNode({ nodeId: req.data.payload.node_id })
            .catch(() => {
              // best-effort
            });
        }

        closeNodeConnections(req.data.payload.node_id, deps);

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "pairing.resolved",
            occurred_at: new Date().toISOString(),
            payload: { pairing },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsPairingRevokeResult.parse({ pairing }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "approval.list") {
    const req = WsApprovalListRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may list approvals"),
      );
    }
    if (!deps.approvalDal) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "approvals not enabled"),
      );
    }

    const status = req.data.payload.status ?? "pending";
    if (status === "cancelled") {
      return Promise.resolve({
        request_id: req.data.request_id,
        type: req.data.type,
        ok: true,
        result: WsApprovalListResult.parse({ approvals: [], next_cursor: undefined }),
      } satisfies WsResponseEnvelope);
    }

    return listApprovals(deps.approvalDal, req.data.payload)
      .then((result) => {
        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsApprovalListResult.parse(result),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "approval.resolve") {
    const req = WsApprovalResolveRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may resolve approvals"),
      );
    }
    if (!deps.approvalDal) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "approvals not enabled"),
      );
    }

    const decision = req.data.payload.decision;
    const reason = req.data.payload.reason;
    const approvalId = req.data.payload.approval_id;
    const mode = req.data.payload.mode;
    const selectedOverride = req.data.payload.selected_override;

    const resolvedBy = {
      connection_id: client.id,
      instance_id: client.instance_id,
      device: client.device,
    };

    const wsPublisher = {
      publish: (evt: WsEventEnvelope, opts?: { targetRole?: "client" | "node" }) =>
        publishEvent(evt, deps, opts),
    };

    return resolveAndApplyApproval({
      approvalDal: deps.approvalDal,
      executionEngine: deps.executionEngine,
      wsPublisher,
      logger: deps.logger,
      approvalId,
      decision,
      reason,
      mode,
      selectedOverride,
      resolvedBy,
    })
      .then((resolution) => {
        if (resolution.kind === "not_found") {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "approval not found");
        }
        if (resolution.kind === "invalid_request") {
          return errorResponse(req.data.request_id, req.data.type, "invalid_request", resolution.message);
        }
        if (resolution.kind === "pending") {
          return errorResponse(req.data.request_id, req.data.type, "conflict", "approval is still pending");
        }
        if (resolution.kind === "conflict") {
          return errorResponse(
            req.data.request_id,
            req.data.type,
            "conflict",
            `approval already resolved as '${resolution.approval.status}'`,
            { approval: toSchemaApproval(resolution.approval) },
          );
        }

        const updated = toSchemaApproval(resolution.approval);
        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsApprovalResolveResult.parse({ approval: updated }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "workflow.resume") {
    const req = WsWorkflowResumeRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may resume workflows"),
      );
    }
    if (!deps.executionEngine) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "workflow control not enabled"),
      );
    }

    return deps.executionEngine
      .resumeRun(req.data.payload.resume_token)
      .then((runId) => {
        if (!runId) {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "resume token not found or not resumable");
        }

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "run.resumed",
            occurred_at: new Date().toISOString(),
            payload: { run_id: runId },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsWorkflowResumeResult.parse({ run_id: runId }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "workflow.cancel") {
    const req = WsWorkflowCancelRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (client.role !== "client") {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "forbidden", "only clients may cancel workflows"),
      );
    }
    if (!deps.executionEngine) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "workflow control not enabled"),
      );
    }

    if (req.data.payload.resume_token) {
      return deps.executionEngine
        .cancelRunByResumeToken(req.data.payload.resume_token, req.data.payload.reason)
        .then((runId) => {
          if (!runId) {
            return errorResponse(req.data.request_id, req.data.type, "not_found", "resume token not found or not cancellable");
          }

          broadcastEvent(
            {
              event_id: crypto.randomUUID(),
              type: "run.cancelled",
              occurred_at: new Date().toISOString(),
              payload: { run_id: runId },
            },
            deps,
            { targetRole: "client" },
          );

          return {
            request_id: req.data.request_id,
            type: req.data.type,
            ok: true,
            result: WsWorkflowCancelResult.parse({ run_id: runId }),
          } satisfies WsResponseEnvelope;
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          return errorResponse(req.data.request_id, req.data.type, "internal", message);
        });
    }

    return deps.executionEngine
      .cancelRun(req.data.payload.run_id!, req.data.payload.reason)
      .then((runId) => {
        if (!runId) {
          return errorResponse(req.data.request_id, req.data.type, "not_found", "run not found or not cancellable");
        }

        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "run.cancelled",
            occurred_at: new Date().toISOString(),
            payload: { run_id: runId },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: WsWorkflowCancelResult.parse({ run_id: runId }),
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  if (msg.type === "presence.beacon") {
    const req = WsPresenceBeaconRequest.safeParse(msg);
    if (!req.success) {
      return Promise.resolve(
        errorResponse(msg.request_id, msg.type, "contract_error", req.error.message, {
          issues: req.error.issues,
        }),
      );
    }
    if (!deps.presence) {
      return Promise.resolve(
        errorResponse(req.data.request_id, req.data.type, "unsupported_request", "presence not enabled"),
      );
    }

    return deps.presence
      .applyBeacon(client, req.data.payload)
      .then((entry) => {
        broadcastEvent(
          {
            event_id: crypto.randomUUID(),
            type: "presence.upsert",
            occurred_at: new Date().toISOString(),
            payload: { entry },
          },
          deps,
          { targetRole: "client" },
        );

        return {
          request_id: req.data.request_id,
          type: req.data.type,
          ok: true,
          result: {},
        } satisfies WsResponseEnvelope;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(req.data.request_id, req.data.type, "internal", message);
      });
  }

  return Promise.resolve(
    errorResponse(msg.request_id, msg.type, "unsupported_request", "request not supported"),
  );
}

async function compileWorkflow(pipeline: string): Promise<{
  playbookId: string;
  steps: ActionPrimitive[];
}> {
  const trimmed = pipeline.trim();
  const nowIso = new Date().toISOString();

  const manifest = await (async (): Promise<unknown> => {
    if (trimmed.startsWith("/")) {
      const abs = resolvePath(trimmed);
      let path = abs;
      try {
        if (statSync(abs).isDirectory()) {
          path = joinPath(abs, "playbook.yml");
        }
      } catch {
        // ignore; readFile will throw
      }
      const raw = await readFile(path, "utf-8");
      return parseYaml(raw) as unknown;
    }

    const parsed = parseYaml(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return {
        id: `inline-${crypto.randomUUID()}`,
        name: "Inline workflow",
        version: "0.0.0",
        steps: parsed,
      };
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        ...record,
        id: typeof record["id"] === "string" && record["id"].trim().length > 0
          ? record["id"]
          : `inline-${crypto.randomUUID()}`,
        name: typeof record["name"] === "string" && record["name"].trim().length > 0
          ? record["name"]
          : "Inline workflow",
        version: typeof record["version"] === "string" && record["version"].trim().length > 0
          ? record["version"]
          : "0.0.0",
      };
    }
    throw new Error("invalid workflow pipeline (expected YAML/JSON object or steps array)");
  })();

  const validated = PlaybookManifest.parse(manifest);

  const runner = new PlaybookRunner();
  const compiled = runner.run({
    manifest: validated,
    file_path: trimmed.startsWith("/") ? resolvePath(trimmed) : "<inline>",
    loaded_at: nowIso,
  });

  return { playbookId: compiled.playbook_id, steps: compiled.steps };
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
  ids: { runId: ExecutionRunId; stepId: ExecutionStepId; attemptId: ExecutionAttemptId },
  deps: ProtocolDeps,
): Promise<string> {
  const capability = requiredCapability(action.type);
  if (capability === undefined) {
    throw new NoCapableClientError(action.type as ClientCapability);
  }

  const client = deps.connectionManager.getClientForCapability(capability);
  if (!client) {
    const cluster = deps.cluster;
    if (!cluster) {
      throw new NoCapableClientError(capability);
    }

    const nowMs = Date.now();
    return (async (): Promise<string> => {
      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
      capability,
      nowMs,
    );
    const target =
      candidates.find((c) => c.edge_id !== cluster.edgeId) ?? candidates[0];
    if (!target || target.edge_id === cluster.edgeId) {
      throw new NoCapableClientError(capability);
    }

    const requestId = `task-${crypto.randomUUID()}`;
    const message: WsRequestEnvelope = {
      request_id: requestId,
      type: "task.execute",
      payload: { run_id: ids.runId, step_id: ids.stepId, attempt_id: ids.attemptId, action },
    };

      await cluster.outboxDal.enqueue(
        "ws.direct",
        { connection_id: target.connection_id, message },
        { targetEdgeId: target.edge_id },
      );
      return requestId;
    })();
  }

  const requestId = `task-${crypto.randomUUID()}`;
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "task.execute",
    payload: { run_id: ids.runId, step_id: ids.stepId, attempt_id: ids.attemptId, action },
  };
  client.ws.send(JSON.stringify(message));
  return Promise.resolve(requestId);
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

  // Send to the first available *human* client (not node peers).
  let sentLocal = false;
  for (const peer of deps.connectionManager.allClients()) {
    if (peer.role !== "client") continue;
    peer.ws.send(payload);
    sentLocal = true;
    break;
  }

  if (sentLocal) {
    if (deps.cluster) {
      void deps.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          target_role: "client",
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
      .enqueue("ws.broadcast", { target_role: "client", message })
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
        target_role: "client",
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

export function publishEvent(
  evt: WsEventEnvelope,
  deps: ProtocolDeps,
  opts?: { targetRole?: "client" | "node" },
): void {
  broadcastEvent(evt, deps, opts);
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

function broadcastEvent(
  evt: WsEventEnvelope,
  deps: ProtocolDeps,
  opts?: { targetRole?: "client" | "node" },
): void {
  const payload = JSON.stringify(evt);
  for (const c of deps.connectionManager.allClients()) {
    if (opts?.targetRole && c.role !== opts.targetRole) continue;
    c.ws.send(payload);
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        target_role: opts?.targetRole,
        message: evt,
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

function evidenceFromErrorDetails(details: unknown): unknown {
  if (details === null || typeof details !== "object") {
    return undefined;
  }
  return (details as { evidence?: unknown }).evidence;
}

async function listApprovals(
  dal: ApprovalDal,
  payload: {
    status?: string;
    kind?: ApprovalKindT[];
    key?: string;
    lane?: string;
    run_id?: string;
    limit: number;
    cursor?: string;
  },
): Promise<{ approvals: ApprovalT[]; next_cursor?: string }> {
  const status = (payload.status ?? "pending") as ApprovalStatusT;
  const limit = Math.max(1, Math.min(500, payload.limit ?? 100));

  const cursorRaw = payload.cursor?.trim();
  const cursorId =
    cursorRaw && /^[0-9]+$/.test(cursorRaw) ? Number(cursorRaw) : undefined;

  const page = await dal.listByStatusDesc(status, { limit, cursorId });
  const mapped = page.map(toSchemaApproval);

  const filtered = mapped.filter((approval) => {
    if (payload.kind && payload.kind.length > 0 && !payload.kind.includes(approval.kind)) {
      return false;
    }
    if (payload.run_id && approval.scope?.run_id !== payload.run_id) {
      return false;
    }
    if (payload.key && approval.scope?.key !== payload.key) {
      return false;
    }
    if (payload.lane && approval.scope?.lane !== payload.lane) {
      return false;
    }
    return true;
  });

  const nextCursor = page.length === limit ? String(page[page.length - 1]!.id) : undefined;

  return {
    approvals: filtered,
    next_cursor: nextCursor,
  };
}

function closeNodeConnections(nodeId: string, deps: ProtocolDeps): void {
  const closeCode = 1012;
  const closeReason = "pairing resolved; reconnect";
  for (const peer of deps.connectionManager.allClients()) {
    if (peer.role !== "node") continue;
    if (peer.instance_id !== nodeId) continue;
    try {
      peer.ws.close(closeCode, closeReason);
    } catch {
      // best-effort
    }
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.close", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        target_role: "node",
        instance_id: nodeId,
        code: closeCode,
        reason: closeReason,
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("outbox.enqueue_failed", {
          topic: "ws.close",
          error: message,
        });
      });
  }
}
