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
} from "@tyrum/contracts";
import type { WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import { SubagentService } from "../../app/modules/workboard/subagent-service.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";
import { broadcastEvent, errorResponse, workboardErrorResponse } from "./helpers.js";
import { ensureWorkScope, resolveExistingWorkScope } from "./workboard-handlers-shared.js";

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

    const subagents = new SubagentService({ db: deps.db });
    try {
      const payload = parsedReq.data.payload;
      const { scope, keys } = await ensureWorkScope({ deps, tenantId, payload });
      const subagentId = crypto.randomUUID();
      const subagent = await subagents.createSubagent({
        scope,
        subagentId,
        subagent: {
          execution_profile: payload.execution_profile,
          conversation_key: `agent:${keys.agentKey}:subagent:${subagentId}`,
          work_item_id: payload.work_item_id,
          work_item_task_id: payload.work_item_task_id,
          status: "running",
        },
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

    const subagents = new SubagentService({ db: deps.db });
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const { subagents: records, next_cursor } = await subagents.listSubagents({
        scope,
        statuses: payload.statuses,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      const result = WsSubagentListResult.parse({ subagents: records, next_cursor });
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

    const subagents = new SubagentService({ db: deps.db });
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const subagent = await subagents.getSubagent({ scope, subagent_id: payload.subagent_id });
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

    const subagents = new SubagentService({ db: deps.db, agents: deps.agents });
    const payload = parsedReq.data.payload;
    let resolved: Awaited<ReturnType<typeof resolveExistingWorkScope>>;
    let subagent: Awaited<ReturnType<SubagentService["getSubagent"]>>;
    try {
      resolved = await resolveExistingWorkScope({ deps, tenantId, payload });
      subagent = await subagents.getSubagent({
        scope: resolved.scope,
        subagent_id: payload.subagent_id,
      });
    } catch (err) {
      return workboardErrorResponse(msg.request_id, msg.type, err, deps);
    }
    const scope = resolved.scope;
    if (!subagent) {
      return errorResponse(msg.request_id, msg.type, "not_found", "subagent not found");
    }
    if (
      subagent.status === "closing" ||
      subagent.status === "closed" ||
      subagent.status === "failed"
    ) {
      return errorResponse(
        msg.request_id,
        msg.type,
        "invalid_state",
        `subagent is ${subagent.status}`,
      );
    }

    void (async () => {
      try {
        const res = await subagents.sendSubagentMessage({
          scope,
          subagent_id: payload.subagent_id,
          message: payload.content,
          subagent,
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
              content: res.reply,
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
          const failed = await subagents.getSubagent({
            scope,
            subagent_id: payload.subagent_id,
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

    await Promise.resolve();
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

    const subagents = new SubagentService({ db: deps.db });
    try {
      const payload = parsedReq.data.payload;
      const { scope } = await resolveExistingWorkScope({ deps, tenantId, payload });
      const closing = await subagents.closeSubagent({
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

      const closed = await subagents.markSubagentClosed({
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
