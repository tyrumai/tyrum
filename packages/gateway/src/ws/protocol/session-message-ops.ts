import { randomUUID } from "node:crypto";
import {
  WsSessionCompactRequest,
  WsSessionCompactResult,
  WsSessionCreateRequest,
  WsSessionCreateResult,
  WsSessionGetRequest,
  WsSessionGetResult,
  WsSessionListRequest,
  WsSessionListResult,
  WsSessionSendRequest,
  WsSessionSendResult,
} from "@tyrum/schemas";
import type { WsResponseEnvelope } from "@tyrum/schemas";
import { SessionDal } from "../../modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../modules/identity/scope.js";
import { resolveWorkspaceKey } from "../../modules/workspace/id.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { broadcastSessionSendStream } from "./session-message-stream.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleSessionListMessage(
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
      "only operator clients may list sessions",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "sessions are not available on this gateway instance",
    );
  }

  const parsedReq = WsSessionListRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const agentKey = parsedReq.data.payload.agent_id ?? "default";
  const connectorKey = parsedReq.data.payload.channel ?? "ui";
  const limit = parsedReq.data.payload.limit ?? 50;
  const sessionDal = createSessionDal(deps);

  try {
    const listed = await sessionDal.list({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      limit,
      cursor: parsedReq.data.payload.cursor,
    });
    const result = WsSessionListResult.parse({
      sessions: listed.sessions.map((session) => ({
        session_id: session.session_id,
        agent_id: session.agent_id,
        channel: session.channel,
        thread_id: session.thread_id,
        title: session.title ?? "",
        summary: session.summary ?? "",
        transcript_count: session.transcript_count,
        updated_at: session.updated_at,
        created_at: session.created_at,
        last_text: session.last_text ?? undefined,
      })),
      next_cursor: listed.nextCursor ?? null,
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent:
        err instanceof Error && err.message === "invalid cursor"
          ? undefined
          : "ws.session_list_failed",
      invalidCursor: err instanceof Error && err.message === "invalid cursor",
      logFields: { agent_id: agentKey },
    });
  }
}

export async function handleSessionGetMessage(
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
      "only operator clients may get sessions",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "sessions are not available on this gateway instance",
    );
  }

  const parsedReq = WsSessionGetRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const agentKey = parsedReq.data.payload.agent_id ?? "default";
  const sessionKey = parsedReq.data.payload.session_id;
  try {
    const looked = await createSessionDal(deps).getWithDeliveryByKey({ tenantId, sessionKey });
    if (!looked || looked.agent_key !== agentKey) {
      return errorResponse(msg.request_id, msg.type, "not_found", "session not found");
    }

    const result = WsSessionGetResult.parse({
      session: {
        session_id: looked.session.session_key,
        agent_id: looked.agent_key,
        channel: looked.connector_key,
        thread_id: looked.provider_thread_id,
        title: looked.session.title ?? "",
        summary: looked.session.summary ?? "",
        transcript: looked.session.transcript,
        updated_at: looked.session.updated_at,
        created_at: looked.session.created_at,
      },
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.session_get_failed",
      logFields: { session_id: sessionKey, agent_id: agentKey },
    });
  }
}

export async function handleSessionCreateMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may create sessions",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "sessions are not available on this gateway instance",
    );
  }

  const parsedReq = WsSessionCreateRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const agentKey = parsedReq.data.payload.agent_id ?? "default";
  const connectorKey = parsedReq.data.payload.channel ?? "ui";
  const providerThreadId = `${connectorKey}-${crypto.randomUUID()}`;
  try {
    const session = await createSessionDal(deps).getOrCreate({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey,
      providerThreadId,
      containerKind: "channel",
    });
    const result = WsSessionCreateResult.parse({
      session_id: session.session_key,
      agent_id: agentKey,
      channel: connectorKey,
      thread_id: providerThreadId,
      title: session.title ?? "",
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.session_create_failed",
      logFields: { agent_id: agentKey, channel: connectorKey },
    });
  }
}

export async function handleSessionCompactMessage(
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
      "only operator clients may compact sessions",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "sessions are not available on this gateway instance",
    );
  }
  if (!deps.agents) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "session compaction is not available on this gateway instance",
    );
  }

  const parsedReq = WsSessionCompactRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const agentKey = parsedReq.data.payload.agent_id ?? "default";
  const sessionKey = parsedReq.data.payload.session_id;
  try {
    const sessionDal = createSessionDal(deps);
    const existing = await sessionDal.getWithDeliveryByKey({ tenantId, sessionKey });
    if (!existing || existing.agent_key !== agentKey) {
      return errorResponse(msg.request_id, msg.type, "not_found", "session not found");
    }

    const runtime = await deps.agents.getRuntime({ tenantId, agentKey });
    const compacted = await runtime.compactSession({
      sessionId: existing.session.session_id,
      keepLastMessages: parsedReq.data.payload.keep_last_messages,
    });
    const result = WsSessionCompactResult.parse({
      session_id: sessionKey,
      dropped_messages: compacted.droppedMessages,
      kept_messages: compacted.keptMessages,
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.session_compact_failed",
      logFields: { session_id: sessionKey, agent_id: agentKey },
    });
  }
}

export async function handleSessionSendMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
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

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "missing tenant id");
  }

  try {
    const agentId = parsedReq.data.payload.agent_id ?? "default";
    const session = deps.db
      ? await createSessionDal(deps).getOrCreate({
          scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
          connectorKey: parsedReq.data.payload.channel,
          providerThreadId: parsedReq.data.payload.thread_id,
          containerKind: "channel",
        })
      : undefined;
    const runtime = await deps.agents.getRuntime({ tenantId, agentKey: agentId });
    const sourceClientDeviceId =
      typeof client.device_id === "string" && client.device_id.trim().length > 0
        ? client.device_id
        : typeof client.auth_claims?.device_id === "string" &&
            client.auth_claims.device_id.trim().length > 0
          ? client.auth_claims.device_id
          : undefined;
    const requestPayload = parsedReq.data.payload as Record<string, unknown>;
    const clientMessageId =
      typeof requestPayload["client_message_id"] === "string"
        ? requestPayload["client_message_id"]
        : randomUUID();
    const stream = await runtime.turnStream({
      channel: parsedReq.data.payload.channel,
      thread_id: parsedReq.data.payload.thread_id,
      message: parsedReq.data.payload.content,
      metadata: {
        source: "ws",
        request_id: msg.request_id,
        ...(sourceClientDeviceId ? { source_client_device_id: sourceClientDeviceId } : {}),
        ...(typeof requestPayload["client_message_id"] === "string"
          ? { client_message_id: requestPayload["client_message_id"] }
          : {}),
        ...(parsedReq.data.payload.attached_node_id
          ? { attached_node_id: parsedReq.data.payload.attached_node_id }
          : {}),
      },
    });
    const sessionKey = session?.session_key ?? stream.sessionId;
    const { approvalRequested } = await broadcastSessionSendStream({
      deps,
      tenantId,
      agentId,
      sessionKey,
      threadId: parsedReq.data.payload.thread_id,
      clientMessageId,
      userContent: parsedReq.data.payload.content,
      stream,
    });

    const response = approvalRequested ? null : await stream.finalize();
    const result = WsSessionSendResult.parse({
      session_id: sessionKey,
      assistant_message: response?.reply ?? "",
    });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.error("ws.session_send_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      agent_id: parsedReq.data.payload.agent_id ?? "default",
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "agent_runtime_error", message);
  }
}

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
