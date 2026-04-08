import type {
  TranscriptConversationSummary,
  TranscriptTimelineEvent,
  TyrumUIMessage,
} from "@tyrum/contracts";
import { ContextReport, WsToolLifecycleEventPayload } from "@tyrum/contracts";
import { ApprovalDal } from "../../app/modules/approval/dal.js";
import { toApprovalContract } from "../../app/modules/approval/to-contract.js";
import type { StateStoreKind } from "../../statestore/types.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import type { ProtocolDeps } from "./types.js";

function normalizeOccurredAt(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function readMessageOccurredAt(message: TyrumUIMessage, fallback: string): string {
  const metadata = message.metadata;
  const createdAt =
    typeof metadata?.["created_at"] === "string"
      ? metadata["created_at"]
      : typeof metadata?.["createdAt"] === "string"
        ? metadata["createdAt"]
        : typeof metadata?.["timestamp"] === "string"
          ? metadata["timestamp"]
          : undefined;
  return normalizeOccurredAt(createdAt, fallback);
}

export function compareTimelineEvents(
  left: TranscriptTimelineEvent,
  right: TranscriptTimelineEvent,
): number {
  const timeCmp = left.occurred_at.localeCompare(right.occurred_at);
  if (timeCmp !== 0) {
    return timeCmp;
  }
  return left.event_id.localeCompare(right.event_id);
}

type RawTranscriptWsEventRow = {
  event_id: string;
  occurred_at: string | Date;
  payload_json: string;
};

type RawContextReportEventRow = {
  context_report_id: string;
  conversation_id: string;
  created_at: string | Date;
  report_json: string;
};

function normalizeDbTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function buildWsEventConversationIdExpression(dbKind: StateStoreKind): string {
  if (dbKind === "postgres") {
    return "payload_json::jsonb ->> 'conversation_id'";
  }
  return "json_extract(payload_json, '$.conversation_id')";
}

export async function resolveToolLifecycleEvents(input: {
  deps: ProtocolDeps;
  tenantId: string;
  conversationIds: string[];
  conversationKeyByConversationId: Map<string, string>;
  summaryByConversationKey: Map<string, TranscriptConversationSummary>;
}): Promise<TranscriptTimelineEvent[]> {
  if (!input.deps.db || input.conversationIds.length === 0) {
    return [];
  }

  const conversationIdExpression = buildWsEventConversationIdExpression(input.deps.db.kind);
  const rows = await input.deps.db.all<RawTranscriptWsEventRow>(
    `SELECT event_id, occurred_at, payload_json
     FROM ws_events
     WHERE tenant_id = ?
       AND type = 'tool.lifecycle'
       AND ${conversationIdExpression} IN (${buildSqlPlaceholders(input.conversationIds.length)})
     ORDER BY occurred_at ASC, event_id ASC`,
    [input.tenantId, ...input.conversationIds],
  );

  return rows.flatMap((row) => {
    const parsed = WsToolLifecycleEventPayload.safeParse(parseJson(row.payload_json));
    if (!parsed.success) {
      return [];
    }
    const conversationKey = input.conversationKeyByConversationId.get(parsed.data.conversation_id);
    if (!conversationKey) {
      return [];
    }
    const summary = input.summaryByConversationKey.get(conversationKey);
    const event: TranscriptTimelineEvent = {
      event_id: `tool_lifecycle:${row.event_id}`,
      kind: "tool_lifecycle",
      occurred_at: normalizeDbTime(row.occurred_at),
      conversation_key: conversationKey,
      parent_conversation_key: summary?.parent_conversation_key,
      subagent_id: summary?.subagent_id,
      payload: {
        tool_event: parsed.data,
      },
    };
    return [event];
  });
}

export async function resolveContextReportEvents(input: {
  deps: ProtocolDeps;
  tenantId: string;
  conversationIds: string[];
  conversationKeyByConversationId: Map<string, string>;
  summaryByConversationKey: Map<string, TranscriptConversationSummary>;
}): Promise<TranscriptTimelineEvent[]> {
  if (!input.deps.db || input.conversationIds.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<RawContextReportEventRow>(
    `SELECT context_report_id, conversation_id, created_at, report_json
     FROM context_reports
     WHERE tenant_id = ?
       AND conversation_id IN (${buildSqlPlaceholders(input.conversationIds.length)})
     ORDER BY created_at ASC, context_report_id ASC`,
    [input.tenantId, ...input.conversationIds],
  );

  return rows.flatMap((row) => {
    const parsed = ContextReport.safeParse(parseJson(row.report_json));
    if (!parsed.success) {
      return [];
    }
    const conversationKey = input.conversationKeyByConversationId.get(row.conversation_id);
    if (!conversationKey) {
      return [];
    }
    const summary = input.summaryByConversationKey.get(conversationKey);
    const event: TranscriptTimelineEvent = {
      event_id: `context_report:${row.context_report_id}`,
      kind: "context_report",
      occurred_at: normalizeDbTime(row.created_at),
      conversation_key: conversationKey,
      parent_conversation_key: summary?.parent_conversation_key,
      subagent_id: summary?.subagent_id,
      payload: {
        report: parsed.data,
      },
    };
    return [event];
  });
}

export async function resolveApprovalEvents(input: {
  deps: ProtocolDeps;
  tenantId: string;
  conversationIds: string[];
  conversationKeyByTurnId: Map<string, string>;
  workflowRunStepIds: string[];
  turnIds: string[];
  summaryByConversationKey: Map<string, TranscriptConversationSummary>;
}): Promise<TranscriptTimelineEvent[]> {
  if (!input.deps.db) {
    return [];
  }
  const clauses: string[] = [];
  const params: unknown[] = [input.tenantId];
  if (input.conversationIds.length > 0) {
    clauses.push(`conversation_id IN (${buildSqlPlaceholders(input.conversationIds.length)})`);
    params.push(...input.conversationIds);
  }
  if (input.turnIds.length > 0) {
    clauses.push(`turn_id IN (${buildSqlPlaceholders(input.turnIds.length)})`);
    params.push(...input.turnIds);
  }
  if (input.workflowRunStepIds.length > 0) {
    clauses.push(
      `workflow_run_step_id IN (${buildSqlPlaceholders(input.workflowRunStepIds.length)})`,
    );
    params.push(...input.workflowRunStepIds);
  }
  if (clauses.length === 0) {
    return [];
  }

  const rows = await input.deps.db.all<{ approval_id: string }>(
    `SELECT approval_id
     FROM approvals
     WHERE tenant_id = ?
       AND (${clauses.join(" OR ")})
     ORDER BY created_at ASC, approval_id ASC`,
    params,
  );

  const approvalDal = new ApprovalDal(input.deps.db);
  const approvalRows = await approvalDal.getByIds({
    tenantId: input.tenantId,
    approvalIds: rows.map((row) => row.approval_id),
    includeReviews: true,
  });

  return approvalRows.flatMap((approvalRow) => {
    const approval = toApprovalContract(approvalRow);
    if (!approval) {
      return [];
    }
    const conversationKey =
      (typeof approval.scope?.turn_id === "string"
        ? input.conversationKeyByTurnId.get(approval.scope.turn_id)
        : undefined) ??
      (approval.scope?.conversation_key?.trim() || "");
    if (!conversationKey) {
      return [];
    }
    const summary = input.summaryByConversationKey.get(conversationKey);
    return [
      {
        event_id: `approval:${approval.approval_id}`,
        kind: "approval" as const,
        occurred_at: approval.created_at,
        conversation_key: conversationKey,
        parent_conversation_key: summary?.parent_conversation_key,
        subagent_id: summary?.subagent_id,
        payload: { approval },
      },
    ];
  });
}
