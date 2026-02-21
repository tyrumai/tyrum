/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import {
  requiredCapability,
  WsApprovalDecision,
  WsError,
  WsMessageEnvelope,
  WsTaskExecuteResult,
} from "@tyrum/schemas";
import type {
  ActionPrimitive,
  ClientCapability,
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsResponseErrEnvelope,
} from "@tyrum/schemas";
import type { ConnectedClient } from "./connection-manager.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { SlashCommandRegistry } from "./slash-commands.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { Logger } from "../modules/observability/logger.js";

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

  /** Slash command registry for handling client /command requests. */
  slashCommands?: SlashCommandRegistry;
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
): WsResponseEnvelope | WsEventEnvelope | undefined {
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

  // Slash command requests
  if (msg.type === "slash.execute" && deps.slashCommands) {
    const payload = msg.payload as { input?: string } | undefined;
    const input = typeof payload?.input === "string" ? payload.input : "";
    // Use async-send pattern (same as onApprovalDecision)
    void deps.slashCommands.execute(input, client.id).then((result) => {
      client.ws.send(JSON.stringify({
        request_id: msg.request_id,
        type: "slash.execute",
        ok: true,
        result,
      }));
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      client.ws.send(JSON.stringify({
        request_id: msg.request_id,
        type: "slash.execute",
        ok: false,
        error: { code: "slash_error", message },
      }));
    });
    return undefined;
  }

  // Requests (client -> gateway). In the current runtime, we don't accept
  // post-handshake client requests via WS (use HTTP routes for now).
  return errorResponse(msg.request_id, msg.type, "unsupported_request", "request not supported");
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
  planId: string,
  stepIndex: number,
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
      payload: { plan_id: planId, step_index: stepIndex, action },
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
    payload: { plan_id: planId, step_index: stepIndex, action },
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

/**
 * Broadcast an approval lifecycle event to all connected clients.
 */
export function sendApprovalUpdate(
  type: "approval.pending" | "approval.resolved",
  payload: Record<string, unknown>,
  deps: ProtocolDeps,
): void {
  const message: WsEventEnvelope = {
    event_id: crypto.randomUUID(),
    type,
    occurred_at: new Date().toISOString(),
    payload,
  };

  const payloadStr = JSON.stringify(message);

  for (const client of deps.connectionManager.allClients()) {
    client.ws.send(payloadStr);
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        message,
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("outbox.enqueue_failed", {
          topic: "ws.broadcast",
          error: msg,
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

function evidenceFromErrorDetails(details: unknown): unknown {
  if (details === null || typeof details !== "object") {
    return undefined;
  }
  return (details as { evidence?: unknown }).evidence;
}
