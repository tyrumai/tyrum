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
import type { WsMessageEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import { WorkboardDal } from "../../modules/workboard/dal.js";
import type { ProtocolDeps } from "./types.js";
import { broadcastEvent, errorResponse, workboardErrorResponse } from "./helpers.js";

type WsRequestEnvelope = Extract<WsMessageEnvelope, { request_id: string; payload: unknown }>;

export async function handleSubagentMessage(
  client: ConnectedClient,
  msg: WsRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (!msg.type.startsWith("subagent.")) return undefined;

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
      const subagentId = crypto.randomUUID();
      const sessionKey = `agent:${payload.agent_id}:subagent:${subagentId}`;
      const subagent = await dal.createSubagent({
        scope: payload,
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
      const { subagents, next_cursor } = await dal.listSubagents({
        scope: payload,
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
      const subagent = await dal.getSubagent({ scope: payload, subagent_id: payload.subagent_id });
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
    let subagent: Awaited<ReturnType<WorkboardDal["getSubagent"]>>;
    try {
      subagent = await dal.getSubagent({ scope: payload, subagent_id: payload.subagent_id });
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
        const runtime = await deps.agents!.getRuntime(payload.agent_id);
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
          {
            event_id: crypto.randomUUID(),
            type: "subagent.output",
            occurred_at: new Date().toISOString(),
            scope: { kind: "agent", agent_id: subagent.agent_id },
            payload: {
              tenant_id: payload.tenant_id,
              agent_id: payload.agent_id,
              workspace_id: payload.workspace_id,
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
            scope: payload,
            subagent_id: payload.subagent_id,
            reason: message,
          });
          if (failed) {
            broadcastEvent(
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
        } catch (err) {
          const updateMessage = err instanceof Error ? err.message : String(err);
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
      const closing = await dal.closeSubagent({
        scope: payload,
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
        scope: payload,
        subagent_id: payload.subagent_id,
      });
      const finalized = closed ?? closing;

      if (finalized.status === "closed") {
        broadcastEvent(
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
