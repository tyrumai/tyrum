import type { WsEventEnvelope, WsResponseErrEnvelope } from "@tyrum/contracts";
import { WsError } from "@tyrum/contracts";
import type { WsBroadcastAudience } from "../audience.js";
import { broadcastWsEvent } from "../broadcast.js";
import type { ProtocolDeps } from "./types.js";

export function errorResponse(
  requestId: string,
  type: string,
  code: string,
  message: string,
  details?: unknown,
): WsResponseErrEnvelope {
  const error = WsError.parse({ code, message, details });
  return { request_id: requestId, type, ok: false, error };
}

export function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function broadcastEvent(
  tenantId: string,
  evt: WsEventEnvelope,
  deps: ProtocolDeps,
  audience?: WsBroadcastAudience,
): void {
  broadcastWsEvent(
    tenantId,
    evt,
    {
      connectionManager: deps.connectionManager,
      cluster: deps.cluster,
      logger: deps.logger,
      maxBufferedBytes: deps.maxBufferedBytes,
    },
    audience,
  );
}

export function errorEvent(code: string, message: string): WsEventEnvelope {
  return {
    event_id: crypto.randomUUID(),
    type: "error",
    occurred_at: new Date().toISOString(),
    payload: { code, message },
  };
}

export function workboardErrorResponse(
  requestId: string,
  type: string,
  err: unknown,
  deps: ProtocolDeps,
): WsResponseErrEnvelope {
  const message = err instanceof Error ? err.message : String(err);
  const errorCode =
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  const details =
    err && typeof err === "object" && "details" in err
      ? (err as { details?: unknown }).details
      : undefined;

  if (
    errorCode === "invalid_transition" ||
    errorCode === "wip_limit_exceeded" ||
    errorCode === "readiness_gate_failed"
  ) {
    return errorResponse(requestId, type, errorCode, message, details);
  }

  if (errorCode === "not_found") {
    return errorResponse(requestId, type, errorCode, message, details);
  }

  const looksLikeSqlError = Boolean(errorCode) || message.includes("SQLITE_");
  if (looksLikeSqlError) {
    deps.logger?.warn("ws.workboard_request_failed", {
      request_id: requestId,
      request_type: type,
      error: message,
      error_code: errorCode,
    });
    return errorResponse(requestId, type, "internal_error", "internal error");
  }
  return errorResponse(requestId, type, "invalid_request", message);
}
