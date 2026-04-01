import type { TranscriptConversationSummary, Turn, TurnItem } from "@tyrum/contracts";
import { TurnBlockReason } from "@tyrum/contracts";
import { TurnItemDal } from "../../app/modules/agent/turn-item-dal.js";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import type { ProtocolDeps } from "./types.js";
import type {
  ConversationRecord,
  LatestTurnInfo,
  TurnDetail,
} from "./transcript-handlers.types.js";

export async function loadTurnDetailsByKey(input: {
  deps: ProtocolDeps;
  tenantId: string;
  keys: string[];
}): Promise<Map<string, TurnDetail[]>> {
  const byKey = new Map<string, TurnDetail[]>();
  if (!input.deps.db || input.keys.length === 0) {
    return byKey;
  }

  const turnRows = await input.deps.db.all<{
    turn_id: string;
    job_id: string;
    key: string;
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
  }>(
    `SELECT
       turn_id AS turn_id,
       job_id,
       conversation_key AS key,
       status,
       attempt,
       created_at,
       started_at,
       finished_at,
       blocked_reason AS paused_reason,
       blocked_detail AS paused_detail,
       policy_snapshot_id,
       budgets_json,
       budget_overridden_at
     FROM turns
     WHERE tenant_id = ?
       AND conversation_key IN (${buildSqlPlaceholders(input.keys.length)})
     ORDER BY created_at ASC, turn_id ASC`,
    [input.tenantId, ...input.keys],
  );

  const turnIds = turnRows.map((row) => row.turn_id);
  const itemsByTurnId =
    turnIds.length === 0
      ? new Map<string, TurnItem[]>()
      : await new TurnItemDal(input.deps.db).listByTurnIds({
          tenantId: input.tenantId,
          turnIds,
        });

  for (const row of turnRows) {
    const turn: Turn = {
      turn_id: row.turn_id,
      job_id: row.job_id,
      conversation_key: row.key,
      status: row.status as Turn["status"],
      attempt: row.attempt,
      created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
      started_at: normalizeDbDateTime(row.started_at),
      finished_at: normalizeDbDateTime(row.finished_at),
      blocked_reason: TurnBlockReason.safeParse(row.paused_reason).success
        ? ((row.paused_reason ?? undefined) as Turn["blocked_reason"])
        : undefined,
      blocked_detail: row.paused_detail ?? undefined,
      policy_snapshot_id: row.policy_snapshot_id ?? undefined,
      budgets: safeJsonParse<Turn["budgets"]>(row.budgets_json, undefined),
      budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
    };
    const details = byKey.get(row.key) ?? [];
    details.push({ turn, turnItems: itemsByTurnId.get(row.turn_id) ?? [] });
    byKey.set(row.key, details);
  }

  return byKey;
}

export async function loadApprovalLinkIdsByTurnIds(input: {
  deps: ProtocolDeps;
  tenantId: string;
  turnIds: readonly string[];
}): Promise<{ stepIds: string[]; attemptIds: string[] }> {
  if (!input.deps.db || input.turnIds.length === 0) {
    return { stepIds: [], attemptIds: [] };
  }

  const stepRows = await input.deps.db.all<{ step_id: string }>(
    `SELECT step_id
     FROM execution_steps
     WHERE tenant_id = ?
       AND turn_id IN (${buildSqlPlaceholders(input.turnIds.length)})
     ORDER BY created_at ASC, step_index ASC`,
    [input.tenantId, ...input.turnIds],
  );
  const stepIds = stepRows.map((row) => row.step_id);
  if (stepIds.length === 0) {
    return { stepIds, attemptIds: [] };
  }

  const attemptRows = await input.deps.db.all<{ attempt_id: string }>(
    `SELECT attempt_id
     FROM execution_attempts
     WHERE tenant_id = ?
       AND step_id IN (${buildSqlPlaceholders(stepIds.length)})
     ORDER BY started_at ASC, attempt ASC`,
    [input.tenantId, ...stepIds],
  );
  return {
    stepIds,
    attemptIds: attemptRows.map((row) => row.attempt_id),
  };
}

export function buildLatestTurnInfoByKey(
  turnDetailsByKey: Map<string, TurnDetail[]>,
): Map<string, LatestTurnInfo> {
  const latestByKey = new Map<string, LatestTurnInfo>();
  for (const [key, details] of turnDetailsByKey) {
    let latest: TurnDetail | null = null;
    let hasActiveTurn = false;
    for (const detail of details) {
      if (
        detail.turn.status === "queued" ||
        detail.turn.status === "running" ||
        detail.turn.status === "paused"
      ) {
        hasActiveTurn = true;
      }
      if (!latest || detail.turn.created_at > latest.turn.created_at) {
        latest = detail;
      }
    }
    latestByKey.set(key, {
      latestTurnId: latest?.turn.turn_id ?? null,
      latestTurnStatus: latest?.turn.status ?? null,
      hasActiveTurn,
    });
  }
  return latestByKey;
}

export async function loadPendingApprovalCountByKey(input: {
  deps: ProtocolDeps;
  tenantId: string;
  keys: string[];
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!input.deps.db || input.keys.length === 0) {
    return counts;
  }
  const rows = await input.deps.db.all<{ conversation_key: string; total: number }>(
    `SELECT r.conversation_key AS conversation_key, COUNT(*) AS total
     FROM approvals a
     JOIN turns r
       ON r.tenant_id = a.tenant_id
      AND r.turn_id = a.turn_id
     WHERE a.tenant_id = ?
       AND a.status IN ('queued', 'reviewing', 'awaiting_human')
       AND r.conversation_key IN (${buildSqlPlaceholders(input.keys.length)})
     GROUP BY r.conversation_key`,
    [input.tenantId, ...input.keys],
  );
  for (const row of rows) {
    counts.set(row.conversation_key, row.total);
  }
  return counts;
}

export function buildTranscriptConversationSummaries(input: {
  conversations: ConversationRecord[];
  subagentsByConversationKey: Map<string, RawSubagentRow>;
  latestTurnsByKey: Map<string, LatestTurnInfo>;
  pendingApprovalsByKey: Map<string, number>;
}): TranscriptConversationSummary[] {
  return input.conversations.map((conversation) => {
    const subagentRow = input.subagentsByConversationKey.get(conversation.conversationKey);
    const latestTurn = input.latestTurnsByKey.get(conversation.conversationKey);
    const pendingApprovalCount = input.pendingApprovalsByKey.get(conversation.conversationKey) ?? 0;
    return {
      conversation_id: conversation.conversationId,
      conversation_key: conversation.conversationKey,
      agent_key: conversation.agentKey,
      channel: conversation.channel,
      account_key: conversation.accountKey ?? undefined,
      thread_id: conversation.threadId,
      container_kind: conversation.containerKind ?? undefined,
      title: conversation.title,
      message_count: conversation.messageCount,
      updated_at: conversation.updatedAt,
      created_at: conversation.createdAt,
      archived: conversation.archived,
      parent_conversation_key: subagentRow?.parent_conversation_key ?? undefined,
      subagent_id: subagentRow?.subagent_id ?? undefined,
      execution_profile: subagentRow?.execution_profile ?? undefined,
      subagent_status: subagentRow?.status as TranscriptConversationSummary["subagent_status"],
      latest_turn_id: latestTurn?.latestTurnId ?? null,
      latest_turn_status: latestTurn?.latestTurnStatus ?? null,
      has_active_turn: latestTurn?.hasActiveTurn ?? false,
      pending_approval_count: pendingApprovalCount,
    };
  });
}

export function attachDirectChildSummaries(input: {
  roots: TranscriptConversationSummary[];
  children: TranscriptConversationSummary[];
}): TranscriptConversationSummary[] {
  const childrenByParentKey = new Map<string, TranscriptConversationSummary[]>();
  for (const child of input.children) {
    const parentConversationKey = child.parent_conversation_key?.trim();
    if (!parentConversationKey) {
      continue;
    }
    const siblings = childrenByParentKey.get(parentConversationKey) ?? [];
    siblings.push(child);
    childrenByParentKey.set(parentConversationKey, siblings);
  }

  const attachChildren = (
    summary: TranscriptConversationSummary,
  ): TranscriptConversationSummary => {
    const childConversations = childrenByParentKey
      .get(summary.conversation_key)
      ?.toSorted((left, right) => left.created_at.localeCompare(right.created_at))
      .map(attachChildren);
    return childConversations && childConversations.length > 0
      ? { ...summary, child_conversations: childConversations }
      : summary;
  };

  return input.roots.map(attachChildren);
}

export function shouldKeepTranscriptRootSummary(
  summary: TranscriptConversationSummary,
  activeOnly: boolean,
): boolean {
  if (!activeOnly) {
    return true;
  }
  if (summary.has_active_turn || summary.pending_approval_count > 0) {
    return true;
  }
  return (summary.child_conversations ?? []).some((child: TranscriptConversationSummary) => {
    return shouldKeepTranscriptRootSummary(child, true);
  });
}
