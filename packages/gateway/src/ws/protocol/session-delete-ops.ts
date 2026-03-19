import {
  WsChatSessionDeleteRequest,
  WsChatSessionDeleteResult,
  type WsResponseEnvelope,
} from "@tyrum/contracts";
import { SessionDal } from "../../modules/agent/session-dal.js";
import { resolveStoredKeyLaneByChannelThread } from "../../modules/agent/stored-key-lane-resolution.js";
import { SessionSendPolicyOverrideDal } from "../../modules/channels/send-policy-override-dal.js";
import { ExecutionEngine } from "../../modules/execution/engine.js";
import { LaneQueueModeOverrideDal } from "../../modules/lanes/queue-mode-override-dal.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleSessionDeleteMessage(
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
      "only operator clients may delete sessions",
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

  const parsedReq = WsChatSessionDeleteRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const sessionKey = parsedReq.data.payload.session_id;
  const looked = await lookupSessionForDelete({
    deps,
    tenantId,
    sessionKey,
    msg,
    client,
  });
  if ("response" in looked) {
    return looked.response;
  }

  const keyLane = await resolveDeleteKeyLane({
    deps,
    looked: looked.session,
    msg,
    client,
  });
  if ("response" in keyLane) {
    return keyLane.response;
  }

  await cleanupDeletedSessionExecution({
    deps,
    tenantId,
    key: keyLane.key,
    lane: keyLane.lane,
    sessionKey,
    agentKey: looked.session.agent_key,
    msg,
    client,
  });

  const deleteResponse = await deleteSessionRows({
    deps,
    tenantId,
    sessionId: looked.session.session.session_id,
    key: keyLane.key,
    lane: keyLane.lane,
    sessionKey,
    agentKey: looked.session.agent_key,
    msg,
    client,
  });
  if (deleteResponse) {
    return deleteResponse;
  }

  try {
    const result = WsChatSessionDeleteResult.parse({ session_id: sessionKey });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.session_delete_parse_failed",
      logFields: { session_id: sessionKey, agent_id: looked.session.agent_key },
    });
  }
}

async function lookupSessionForDelete(params: {
  deps: ProtocolDeps;
  tenantId: string;
  sessionKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<
  | { response: WsResponseEnvelope }
  | { session: NonNullable<Awaited<ReturnType<SessionDal["getWithDeliveryByKey"]>>> }
> {
  const { deps, tenantId, sessionKey, msg, client } = params;
  try {
    const looked = await createSessionDal(deps).getWithDeliveryByKey({ tenantId, sessionKey });
    if (!looked) {
      return {
        response: errorResponse(msg.request_id, msg.type, "not_found", "session not found"),
      };
    }
    return { session: looked };
  } catch (err) {
    return {
      response: sessionErrorResponse({
        deps,
        err,
        msg,
        client,
        logEvent: "ws.session_delete_lookup_failed",
        logFields: { session_id: sessionKey },
      }),
    };
  }
}

async function resolveDeleteKeyLane(params: {
  deps: ProtocolDeps;
  looked: NonNullable<Awaited<ReturnType<SessionDal["getWithDeliveryByKey"]>>>;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<{ response: WsResponseEnvelope } | { key: string; lane: string }> {
  const { deps, looked, msg, client } = params;
  try {
    const keyLane = (await resolveStoredKeyLaneByChannelThread(deps.db!, {
      agentId: looked.agent_key,
      channel: looked.connector_key,
      threadId: looked.provider_thread_id,
    })) ?? { key: looked.session.session_key, lane: "main" };

    return { key: keyLane.key, lane: keyLane.lane };
  } catch (err) {
    return {
      response: sessionErrorResponse({
        deps,
        err,
        msg,
        client,
        logEvent: "ws.session_delete_key_resolution_failed",
        logFields: { session_id: looked.session.session_key, agent_id: looked.agent_key },
      }),
    };
  }
}

async function cleanupDeletedSessionExecution(params: {
  deps: ProtocolDeps;
  tenantId: string;
  key: string;
  lane: string;
  sessionKey: string;
  agentKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<void> {
  const { deps, tenantId, key, lane, sessionKey, agentKey, msg, client } = params;
  try {
    const engine =
      deps.engine ??
      new ExecutionEngine({
        db: deps.db!,
        policyService: deps.policyService,
        redactionEngine: deps.redactionEngine,
        logger: deps.logger,
        eventsEnabled: true,
      });

    const activeRuns = await deps.db!.all<{ run_id: string }>(
      `SELECT run_id
       FROM execution_runs
       WHERE tenant_id = ? AND key = ? AND lane = ? AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC`,
      [tenantId, key, lane],
    );
    for (const row of activeRuns) {
      await engine.cancelRun(row.run_id, "deleted by session.delete");
    }

    await deps.db!.run(
      `UPDATE channel_inbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = COALESCE(processed_at, ?),
           error = COALESCE(error, ?),
           reply_text = COALESCE(reply_text, '')
       WHERE tenant_id = ? AND status = 'queued' AND key = ? AND lane = ?`,
      [new Date().toISOString(), "cancelled by session.delete", tenantId, key, lane],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("ws.session_delete.cleanup_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      session_id: sessionKey,
      agent_id: agentKey,
      error: message,
    });
  }
}

async function deleteSessionRows(params: {
  deps: ProtocolDeps;
  tenantId: string;
  sessionId: string;
  key: string;
  lane: string;
  sessionKey: string;
  agentKey: string;
  msg: ProtocolRequestEnvelope;
  client: ConnectedClient;
}): Promise<WsResponseEnvelope | undefined> {
  const { deps, tenantId, sessionId, key, lane, sessionKey, agentKey, msg, client } = params;
  try {
    await deps.db!.transaction(async (tx) => {
      await tx.run(
        `DELETE FROM session_model_overrides
         WHERE tenant_id = ? AND session_id = ?`,
        [tenantId, sessionId],
      );
      await tx.run(
        `DELETE FROM session_provider_pins
         WHERE tenant_id = ? AND session_id = ?`,
        [tenantId, sessionId],
      );
      await new LaneQueueModeOverrideDal(tx).clear({ tenant_id: tenantId, key, lane });
      await new SessionSendPolicyOverrideDal(tx).clear({ tenant_id: tenantId, key });
      await tx.run(
        `DELETE FROM sessions
         WHERE tenant_id = ? AND session_id = ?`,
        [tenantId, sessionId],
      );
    });
    return undefined;
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.session_delete_failed",
      logFields: { session_id: sessionKey, agent_id: agentKey },
    });
  }
}
