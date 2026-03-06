import {
  WsSubagentCloseRequest,
  WsSubagentCloseResult,
  WsSubagentGetRequest,
  WsSubagentGetResult,
  WsSubagentListRequest,
  WsSubagentListResult,
  WsSubagentSendRequest,
  WsSubagentSendResult,
  WsSubagentSpawnRequest,
  WsSubagentSpawnResult,
} from "@tyrum/schemas";
import type { WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import { WorkboardDal } from "../../modules/workboard/dal.js";
import { IdentityScopeDal, normalizeScopeKeys } from "../../modules/identity/scope.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { broadcastEvent, errorResponse, workboardErrorResponse } from "./helpers.js";

type ScopeKeysPayload = {
  tenant_key?: string;
  agent_key?: string;
  workspace_key?: string;
};

async function resolveWorkScope(params: {
  deps: ProtocolDeps;
  tenantId: string;
  payload: ScopeKeysPayload;
}): Promise<{
  scope: { tenant_id: string; agent_id: string; workspace_id: string };
  keys: { agentKey: string; workspaceKey: string };
}> {
  if (!params.deps.db) {
    throw new Error("db is required");
  }

  const identityScopeDal = params.deps.identityScopeDal ?? new IdentityScopeDal(params.deps.db);
  const keys = normalizeScopeKeys({
    agentKey: params.payload.agent_key,
    workspaceKey: params.payload.workspace_key,
  });
  const tenantId = params.tenantId.trim();
  const agentId = await identityScopeDal.ensureAgentId(tenantId, keys.agentKey);
  const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, keys.workspaceKey);
  await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
  return {
    keys: { agentKey: keys.agentKey, workspaceKey: keys.workspaceKey },
    scope: {
      tenant_id: tenantId,
      agent_id: agentId,
      workspace_id: workspaceId,
    },
  };
}

export async function handleSubagentMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (!msg.type.startsWith("subagent.")) return undefined;
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  if (msg.type === "subagent.spawn") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may spawn subagents",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "subagent.spawn not supported",
      );
    }

    const parsedReq = WsSubagentSpawnRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db);
    try {
      const payload = parsedReq.data.payload;
      const { scope, keys } = await resolveWorkScope({ deps, tenantId, payload });
      const subagentId = crypto.randomUUID();
      const sessionKey = `agent:${keys.agentKey}:subagent:${subagentId}`;
      const subagent = await dal.createSubagent({
        scope,
        subagent: {
          execution_profile: payload.execution_profile,
          session_key: sessionKey,
          work_item_id: payload.work_item_id,
          work_item_task_id: payload.work_item_task_id,
          lane: "subagent",
          status: "running",
        },
        subagentId,
      });

      broadcastEvent(
        scope.tenant_id,
        {
          event_id: crypto.randomUUID(),
          type: "subagent.spawned",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: subagent.agent_id },
          payload: { subagent },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const result = WsSubagentSpawnResult.parse({ subagent });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "subagent.list") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may list subagents",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "subagent.list not supported",
      );
    }

    const parsedReq = WsSubagentListRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db);
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveWorkScope({ deps, tenantId, payload });
      const { subagents, next_cursor } = await dal.listSubagents({
        scope,
        statuses: payload.statuses,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      const result = WsSubagentListResult.parse({ subagents, next_cursor });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "subagent.get") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may fetch subagents",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "subagent.get not supported",
      );
    }

    const parsedReq = WsSubagentGetRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db);
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveWorkScope({ deps, tenantId, payload });
      const subagent = await dal.getSubagent({ scope, subagent_id: payload.subagent_id });
      if (!subagent) {
        return errorResponse(msg.request_id, msg.type, "not_found", "subagent not found");
      }
      const result = WsSubagentGetResult.parse({ subagent });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  if (msg.type === "subagent.send") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may send subagent messages",
      );
    }
    if (!deps.db || !deps.agents) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "subagent.send not supported",
      );
    }

    const parsedReq = WsSubagentSendRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db);
    const payload = parsedReq.data.payload;
    const resolved = await resolveWorkScope({ deps, tenantId, payload });
    const scope = resolved.scope;
    const agentKey = resolved.keys.agentKey;
    let subagent: Awaited<ReturnType<WorkboardDal["getSubagent"]>>;
    try {
      subagent = await dal.getSubagent({ scope, subagent_id: payload.subagent_id });
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }

    if (!subagent) {
      return errorResponse(msg.request_id, msg.type, "not_found", "subagent not found");
    }
    if (subagent.status !== "running") {
      return errorResponse(msg.request_id, msg.type, "invalid_state", "subagent is not running");
    }

    void (async () => {
      try {
        const runtime = await deps.agents!.getRuntime({ tenantId: scope.tenant_id, agentKey });
        const res = await runtime.turn({
          channel: "subagent",
          thread_id: subagent.subagent_id,
          message: payload.content,
          metadata: {
            tyrum_key: subagent.session_key,
            lane: subagent.lane,
            subagent_id: subagent.subagent_id,
            ...(subagent.work_item_id ? { work_item_id: subagent.work_item_id } : {}),
            ...(subagent.work_item_task_id
              ? { work_item_task_id: subagent.work_item_task_id }
              : {}),
          },
        });

        broadcastEvent(
          scope.tenant_id,
          {
            event_id: crypto.randomUUID(),
            type: "subagent.output",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: subagent.agent_id },
            payload: {
              tenant_id: scope.tenant_id,
              agent_id: scope.agent_id,
              workspace_id: scope.workspace_id,
              subagent_id: subagent.subagent_id,
              ...(subagent.work_item_id ? { work_item_id: subagent.work_item_id } : {}),
              ...(subagent.work_item_task_id
                ? { work_item_task_id: subagent.work_item_task_id }
                : {}),
              kind: "final",
              content: res.reply ?? "",
            },
          },
          deps,
          WORKBOARD_WS_AUDIENCE,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("ws.subagent_send_failed", {
          request_id: msg.request_id,
          client_id: client.id,
          request_type: msg.type,
          subagent_id: payload.subagent_id,
          error: message,
        });

        try {
          const failed = await dal.markSubagentFailed({
            scope,
            subagent_id: payload.subagent_id,
            reason: message,
          });
          if (failed) {
            broadcastEvent(
              scope.tenant_id,
              {
                event_id: crypto.randomUUID(),
                type: "subagent.updated",
                occurred_at: new Date().toISOString(),
                scope: { kind: "agent", agent_id: failed.agent_id },
                payload: { subagent: failed },
              },
              deps,
              WORKBOARD_WS_AUDIENCE,
            );
          }
        } catch (updateErr) {
          const updateMessage = updateErr instanceof Error ? updateErr.message : String(updateErr);
          deps.logger?.warn("ws.subagent_failure_update_failed", {
            request_id: msg.request_id,
            client_id: client.id,
            request_type: msg.type,
            subagent_id: payload.subagent_id,
            error: updateMessage,
          });
        }
      }
    })();

    const result = WsSubagentSendResult.parse({ accepted: true });
    return { request_id: msg.request_id, type: msg.type, ok: true, result };
  }

  if (msg.type === "subagent.close") {
    if (client.role !== "client") {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unauthorized",
        "only operator clients may close subagents",
      );
    }
    if (!deps.db) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "subagent.close not supported",
      );
    }

    const parsedReq = WsSubagentCloseRequest.safeParse(msg);
    if (!parsedReq.success) {
      return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
        issues: parsedReq.error.issues,
      });
    }

    const dal = new WorkboardDal(deps.db);
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveWorkScope({ deps, tenantId, payload });
      const closing = await dal.closeSubagent({
        scope,
        subagent_id: payload.subagent_id,
        reason: payload.reason,
      });
      if (!closing) {
        return errorResponse(msg.request_id, msg.type, "not_found", "subagent not found");
      }

      // Failed/closed subagents are terminal; treat close as idempotent no-op (no lifecycle events).
      if (closing.status === "failed" || closing.status === "closed") {
        const result = WsSubagentCloseResult.parse({ subagent: closing });
        return { request_id: msg.request_id, type: msg.type, ok: true, result };
      }

      broadcastEvent(
        scope.tenant_id,
        {
          event_id: crypto.randomUUID(),
          type: "subagent.updated",
          occurred_at: new Date().toISOString(),
          scope: { kind: "agent", agent_id: closing.agent_id },
          payload: { subagent: closing },
        },
        deps,
        WORKBOARD_WS_AUDIENCE,
      );

      const closed = await dal.markSubagentClosed({
        scope,
        subagent_id: payload.subagent_id,
      });
      const finalized = closed ?? closing;

      if (finalized.status === "closed") {
        broadcastEvent(
          scope.tenant_id,
          {
            event_id: crypto.randomUUID(),
            type: "subagent.closed",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: finalized.agent_id },
            payload: { subagent: finalized },
          },
          deps,
          WORKBOARD_WS_AUDIENCE,
        );
      } else if (finalized.status !== closing.status) {
        broadcastEvent(
          scope.tenant_id,
          {
            event_id: crypto.randomUUID(),
            type: "subagent.updated",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: finalized.agent_id },
            payload: { subagent: finalized },
          },
          deps,
          WORKBOARD_WS_AUDIENCE,
        );
      }

      const result = WsSubagentCloseResult.parse({ subagent: finalized });
      return { request_id: msg.request_id, type: msg.type, ok: true, result };
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
  }

  return errorResponse(msg.request_id, msg.type, "unsupported_request", "request not supported");
}
