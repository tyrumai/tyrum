/**
 * WebSocket message dispatch and capability routing.
 *
 * Bridges between raw WebSocket frames and the business-logic modules
 * (state machine, postcondition evaluator, etc.).
 */

import { WsMessageEnvelope } from "@tyrum/schemas";
import type { WsEventEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import { hasAnyRequiredScope } from "../../modules/auth/scopes.js";
import { resolveWsRequestRequiredScopes } from "../../modules/authz/ws-scope-matrix.js";
import type { ConnectedClient } from "../connection-manager.js";
import { handleApprovalMessage } from "./approval-handlers.js";
import { handleControlPlaneMessage } from "./control-plane-handlers.js";
import { errorEvent, errorResponse } from "./helpers.js";
import { handleMemoryMessage } from "./memory-handlers.js";
import { handleNodeMessage } from "./node-handlers.js";
import { handleResponseMessage } from "./response-handlers.js";
import { handleSessionMessage } from "./session-handlers.js";
import { handleSubagentMessage } from "./subagent-handlers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope, ProtocolResponseEnvelope } from "./types.js";
import { handleWorkboardMessage } from "./workboard-handlers.js";
import { requireTenantIdValue } from "../../modules/identity/scope.js";

type ParsedMessageResult =
  | { ok: true; msg: ProtocolRequestEnvelope | ProtocolResponseEnvelope }
  | { ok: false; response: WsEventEnvelope };

const NODE_DEVICE_REQUEST_TYPES = new Set([
  "attempt.evidence",
  "capability.ready",
  "location.beacon",
]);

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
  const parsed = parseIncomingMessage(raw);
  if (!parsed.ok) {
    return parsed.response;
  }

  const msg = parsed.msg;
  if ("ok" in msg) {
    return handleResponseMessage(client, msg, deps);
  }

  const authzError = await authorizeRequest(client, msg, deps);
  if (authzError) {
    return authzError;
  }

  return routeRequest(client, msg, raw, deps);
}

function parseIncomingMessage(raw: string): ParsedMessageResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (_err) {
    void _err;
    return {
      ok: false,
      response: errorEvent("invalid_json", "message is not valid JSON"),
    };
  }

  const parsed = WsMessageEnvelope.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: errorEvent("invalid_message", parsed.error.message),
    };
  }

  if ("event_id" in parsed.data) {
    return {
      ok: false,
      response: errorEvent("unexpected_event", "clients must not send events"),
    };
  }

  return { ok: true, msg: parsed.data };
}

async function authorizeRequest(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  const authClaims = client.auth_claims;
  if (!authClaims) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "missing auth claims");
  }

  if (authClaims.token_kind === "device") {
    const requiredScopes = resolveWsRequestRequiredScopes(msg.type);
    if (!requiredScopes) {
      if (
        client.role === "node" &&
        authClaims.role === "node" &&
        NODE_DEVICE_REQUEST_TYPES.has(msg.type)
      ) {
        try {
          requireTenantIdValue(authClaims.tenant_id, "tenant token required");
        } catch {
          return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
        }
        return undefined;
      }
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
        tenant_id: authClaims.tenant_id ?? undefined,
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
        tenant_id: authClaims.tenant_id ?? undefined,
        required_scopes: requiredScopes,
        request_type: msg.type,
        request_id: msg.request_id,
        client_id: client.id,
      });
      return errorResponse(msg.request_id, msg.type, "forbidden", "insufficient scope");
    }
  }

  try {
    requireTenantIdValue(authClaims.tenant_id, "tenant token required");
  } catch {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  return undefined;
}

async function routeRequest(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  raw: string,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  const handlers: Array<() => Promise<WsResponseEnvelope | undefined>> = [
    async () => handleControlPlaneMessage(client, msg, deps),
    async () => handleApprovalMessage(client, msg, deps),
    async () => handleNodeMessage(client, msg, raw, deps),
    async () => handleSessionMessage(client, msg, deps),
    async () => handleSubagentMessage(client, msg, deps),
    async () => handleWorkboardMessage(client, msg, deps),
    async () => handleMemoryMessage(client, msg, deps),
  ];

  for (const handler of handlers) {
    const response = await handler();
    if (response) {
      return response;
    }
  }

  return errorResponse(msg.request_id, msg.type, "unsupported_request", "request not supported");
}
