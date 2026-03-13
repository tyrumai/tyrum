import type { WsResponseEnvelope } from "@tyrum/schemas";
import { SessionDal } from "../../modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../modules/identity/scope.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export function createSessionDal(deps: ProtocolDeps): SessionDal {
  if (!deps.db) {
    throw new Error("missing db");
  }
  const identityScopeDal =
    deps.identityScopeDal ?? new IdentityScopeDal(deps.db, { cacheTtlMs: 60_000 });
  return new SessionDal(deps.db, identityScopeDal, new ChannelThreadDal(deps.db));
}

export function sessionErrorResponse(params: {
  deps: ProtocolDeps;
  err: unknown;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
  logEvent?: string;
  invalidCursor?: boolean;
  logFields?: Record<string, unknown>;
}): WsResponseEnvelope {
  const { deps, err, msg, client, logEvent, invalidCursor, logFields } = params;
  const message = err instanceof Error ? err.message : String(err);
  if (invalidCursor) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", "invalid cursor");
  }
  if (logEvent) {
    deps.logger?.error(logEvent, {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      ...logFields,
      error: message,
    });
  }
  return errorResponse(msg.request_id, msg.type, "internal_error", "internal error");
}
