/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import {
  ClientMessage,
  requiredCapability,
} from "@tyrum/schemas";
import type {
  ActionPrimitive,
  ClientCapability,
  GatewayMessage,
} from "@tyrum/schemas";
import type { ConnectedClient } from "./connection-manager.js";
import type { ConnectionManager } from "./connection-manager.js";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/**
 * External dependencies injected into the protocol handler so the module
 * stays unit-testable without real services.
 */
export interface ProtocolDeps {
  connectionManager: ConnectionManager;

  /** Called when a task_result is received from a client. */
  onTaskResult?: (
    taskId: string,
    success: boolean,
    evidence: unknown,
    error: string | undefined,
  ) => void;

  /** Called when a human_response is received from a client. */
  onHumanResponse?: (
    planId: string,
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
): GatewayMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      type: "error",
      code: "invalid_json",
      message: "message is not valid JSON",
    };
  }

  const parsed = ClientMessage.safeParse(json);
  if (!parsed.success) {
    return {
      type: "error",
      code: "invalid_message",
      message: parsed.error.message,
    };
  }

  const msg = parsed.data;

  switch (msg.type) {
    case "hello":
      // hello is handled at the connection layer, not here.
      return {
        type: "error",
        code: "unexpected_hello",
        message: "hello must be the first message on a new connection",
      };

    case "task_result":
      deps.onTaskResult?.(msg.task_id, msg.success, msg.evidence, msg.error);
      return undefined;

    case "human_response":
      deps.onHumanResponse?.(msg.plan_id, msg.approved, msg.reason);
      return undefined;

    case "pong":
      client.lastPong = Date.now();
      return undefined;
  }
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
  _stepIndex: number,
  deps: ProtocolDeps,
): string {
  const capability = requiredCapability(action.type);
  if (capability === undefined) {
    throw new NoCapableClientError(action.type as ClientCapability);
  }

  const client = deps.connectionManager.getClientForCapability(capability);
  if (!client) {
    throw new NoCapableClientError(capability);
  }

  const taskId = crypto.randomUUID();
  const message: GatewayMessage = {
    type: "task_dispatch",
    task_id: taskId,
    plan_id: planId,
    action,
  };
  client.ws.send(JSON.stringify(message));
  return taskId;
}

/**
 * Send a `human_confirmation` request to the first connected client.
 *
 * Human confirmations are not capability-scoped; any connected client
 * with a human operator can respond.
 */
export function requestHumanConfirmation(
  planId: string,
  stepIndex: number,
  prompt: string,
  context: unknown,
  deps: ProtocolDeps,
): void {
  const message: GatewayMessage = {
    type: "human_confirmation",
    plan_id: planId,
    step_index: stepIndex,
    prompt,
    context,
  };
  const payload = JSON.stringify(message);

  // Send to the first available client.
  const iter = deps.connectionManager.allClients();
  const first = iter.next();
  if (!first.done) {
    first.value.ws.send(payload);
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
  const message: GatewayMessage = {
    type: "plan_update",
    plan_id: planId,
    status,
    detail,
  };
  const payload = JSON.stringify(message);

  for (const client of deps.connectionManager.allClients()) {
    client.ws.send(payload);
  }
}
