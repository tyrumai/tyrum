import {
  TurnTriggerKind,
  type TurnTriggerKind as TurnTriggerKindT,
  WsTurnListRequest,
  WsTurnListResult,
} from "@tyrum/contracts";
import type { WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import { errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTurnTriggerKind(
  triggerJson: string | null | undefined,
): TurnTriggerKindT | undefined {
  const trigger = safeJsonParse(triggerJson, undefined as unknown);
  if (!isRecord(trigger)) {
    return undefined;
  }

  const parsed = TurnTriggerKind.safeParse(trigger["kind"]);
  return parsed.success ? parsed.data : undefined;
}

export async function handleRunListMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may list runs",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "turn.list not supported",
    );
  }

  const parsedReq = WsTurnListRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  const limit = parsedReq.data.payload.limit ?? 100;
  const statuses = parsedReq.data.payload.statuses ?? [];
  const statusClause =
    statuses.length > 0 ? ` AND r.status IN (${buildSqlPlaceholders(statuses.length)})` : "";

  const turnRows = await deps.db.all<{
    turn_id: string;
    job_id: string;
    turn_conversation_key: string;
    status: string;
    attempt: number;
    created_at: string | Date;
    started_at: string | Date | null;
    finished_at: string | Date | null;
    paused_reason: string | null;
    paused_detail: string | null;
    policy_snapshot_id: string | null;
    budgets_json: string | null;
    budget_overridden_at: string | Date | null;
    agent_key: string | null;
    retained_conversation_key: string | null;
    trigger_json?: string | null;
  }>(
    `SELECT
       r.turn_id,
       r.job_id,
       r.conversation_key AS turn_conversation_key,
       r.status,
       r.attempt,
       r.created_at,
       r.started_at,
       r.finished_at,
       r.blocked_reason AS paused_reason,
       r.blocked_detail AS paused_detail,
       r.policy_snapshot_id,
       r.budgets_json,
       r.budget_overridden_at,
       ag.agent_key AS agent_key,
       s.conversation_key AS retained_conversation_key,
       j.trigger_json
     FROM turns r
     JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
     LEFT JOIN agents ag ON ag.tenant_id = j.tenant_id AND ag.agent_id = j.agent_id
     LEFT JOIN conversations s
       ON s.tenant_id = j.tenant_id
      AND s.conversation_id = j.conversation_id
     WHERE r.tenant_id = ?${statusClause}
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [tenantId, ...statuses, limit],
  );
  const result = WsTurnListResult.parse({
    turns: turnRows.map((row) => {
      const turn = {
        turn_id: row.turn_id,
        job_id: row.job_id,
        conversation_key: row.turn_conversation_key,
        status: row.status,
        attempt: row.attempt,
        created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
        started_at: normalizeDbDateTime(row.started_at),
        finished_at: normalizeDbDateTime(row.finished_at),
        blocked_reason: row.paused_reason ?? undefined,
        blocked_detail: row.paused_detail ?? undefined,
        policy_snapshot_id: row.policy_snapshot_id ?? undefined,
        budgets: safeJsonParse(row.budgets_json, undefined as unknown),
        budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
      };
      const turnItem: {
        turn: typeof turn;
        agent_key?: string;
        conversation_key?: string;
        trigger_kind?: TurnTriggerKindT;
      } = { turn };
      if (row.agent_key) {
        turnItem.agent_key = row.agent_key;
      }
      if (row.retained_conversation_key) {
        turnItem.conversation_key = row.retained_conversation_key;
      }
      const triggerKind = parseTurnTriggerKind(row.trigger_json);
      if (triggerKind) {
        turnItem.trigger_kind = triggerKind;
      }
      return turnItem;
    }),
  });

  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}
