import type {
  ExecutionAttempt,
  ExecutionStep,
  TranscriptConversationSummary,
  Turn,
} from "@tyrum/contracts";
import { TurnBlockReason } from "@tyrum/contracts";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import type { ProtocolDeps } from "./types.js";
import type { LatestRunInfo, RunDetail, SessionRecord } from "./transcript-handlers.types.js";

const FALLBACK_ACTION: ExecutionStep["action"] = {
  type: "Decide",
  args: {},
};

export async function loadRunDetailsByKey(input: {
  deps: ProtocolDeps;
  tenantId: string;
  keys: string[];
}): Promise<Map<string, RunDetail[]>> {
  const byKey = new Map<string, RunDetail[]>();
  if (!input.deps.db || input.keys.length === 0) {
    return byKey;
  }

  const runRows = await input.deps.db.all<{
    run_id: string;
    job_id: string;
    key: string;
    lane: string;
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
       turn_id AS run_id,
       job_id,
       conversation_key AS key,
       lane,
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
     ORDER BY created_at ASC, run_id ASC`,
    [input.tenantId, ...input.keys],
  );

  const runIds = runRows.map((row) => row.run_id);
  const stepRows =
    runIds.length === 0
      ? []
      : await input.deps.db.all<{
          step_id: string;
          run_id: string;
          step_index: number;
          status: string;
          action_json: string;
          created_at: string | Date;
          idempotency_key: string | null;
          postcondition_json: string | null;
          approval_id: string | null;
        }>(
          `SELECT
             step_id,
             turn_id AS run_id,
             step_index,
             status,
             action_json,
             created_at,
             idempotency_key,
             postcondition_json,
             approval_id
           FROM execution_steps
           WHERE tenant_id = ?
             AND turn_id IN (${buildSqlPlaceholders(runIds.length)})
           ORDER BY created_at ASC, step_index ASC`,
          [input.tenantId, ...runIds],
        );

  const stepIds = stepRows.map((row) => row.step_id);
  const attemptRows =
    stepIds.length === 0
      ? []
      : await input.deps.db.all<{
          attempt_id: string;
          step_id: string;
          attempt: number;
          status: string;
          started_at: string | Date;
          finished_at: string | Date | null;
          result_json: string | null;
          error: string | null;
          postcondition_report_json: string | null;
          artifacts_json: string;
          cost_json: string | null;
          metadata_json: string | null;
          policy_snapshot_id: string | null;
          policy_decision_json: string | null;
          policy_applied_override_ids_json: string | null;
        }>(
          `SELECT
             attempt_id,
             step_id,
             attempt,
             status,
             started_at,
             finished_at,
             result_json,
             error,
             postcondition_report_json,
             artifacts_json,
             cost_json,
             metadata_json,
             policy_snapshot_id,
             policy_decision_json,
             policy_applied_override_ids_json
           FROM execution_attempts
           WHERE tenant_id = ?
             AND step_id IN (${buildSqlPlaceholders(stepIds.length)})
           ORDER BY started_at ASC, attempt ASC`,
          [input.tenantId, ...stepIds],
        );

  const stepsByRunId = new Map<string, ExecutionStep[]>();
  for (const row of stepRows) {
    const steps = stepsByRunId.get(row.run_id) ?? [];
    steps.push({
      step_id: row.step_id,
      turn_id: row.run_id,
      step_index: row.step_index,
      status: row.status as ExecutionStep["status"],
      action: safeJsonParse<ExecutionStep["action"]>(row.action_json, FALLBACK_ACTION),
      created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
      idempotency_key: row.idempotency_key ?? undefined,
      postcondition: safeJsonParse<ExecutionStep["postcondition"]>(
        row.postcondition_json,
        undefined,
      ),
      approval_id: row.approval_id ?? undefined,
    });
    stepsByRunId.set(row.run_id, steps);
  }

  const attemptsByStepId = new Map<string, ExecutionAttempt[]>();
  for (const row of attemptRows) {
    const attempts = attemptsByStepId.get(row.step_id) ?? [];
    attempts.push({
      attempt_id: row.attempt_id,
      step_id: row.step_id,
      attempt: row.attempt,
      status: row.status as ExecutionAttempt["status"],
      started_at: normalizeDbDateTime(row.started_at) ?? new Date().toISOString(),
      finished_at: normalizeDbDateTime(row.finished_at),
      result: safeJsonParse<ExecutionAttempt["result"]>(row.result_json, undefined),
      error: row.error,
      postcondition_report: safeJsonParse<ExecutionAttempt["postcondition_report"]>(
        row.postcondition_report_json,
        undefined,
      ),
      artifacts: safeJsonParse<ExecutionAttempt["artifacts"]>(row.artifacts_json, []),
      cost: safeJsonParse<ExecutionAttempt["cost"]>(row.cost_json, undefined),
      metadata: safeJsonParse<ExecutionAttempt["metadata"]>(row.metadata_json, undefined),
      policy_snapshot_id: row.policy_snapshot_id ?? undefined,
      policy_decision: safeJsonParse<ExecutionAttempt["policy_decision"]>(
        row.policy_decision_json,
        undefined,
      ),
      policy_applied_override_ids: safeJsonParse<ExecutionAttempt["policy_applied_override_ids"]>(
        row.policy_applied_override_ids_json,
        undefined,
      ),
    });
    attemptsByStepId.set(row.step_id, attempts);
  }

  for (const row of runRows) {
    const turn: Turn = {
      turn_id: row.run_id,
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
    const steps = stepsByRunId.get(row.run_id) ?? [];
    const attempts = steps.flatMap((step) => attemptsByStepId.get(step.step_id) ?? []);
    const details = byKey.get(row.key) ?? [];
    details.push({ turn, steps, attempts });
    byKey.set(row.key, details);
  }

  return byKey;
}

export function buildLatestRunInfoByKey(
  runDetailsByKey: Map<string, RunDetail[]>,
): Map<string, LatestRunInfo> {
  const latestByKey = new Map<string, LatestRunInfo>();
  for (const [key, details] of runDetailsByKey) {
    let latest: RunDetail | null = null;
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
  const rows = await input.deps.db.all<{ session_key: string; total: number }>(
    `SELECT r.conversation_key AS session_key, COUNT(*) AS total
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
    counts.set(row.session_key, row.total);
  }
  return counts;
}

export function buildTranscriptSessionSummaries(input: {
  sessions: SessionRecord[];
  subagentsBySessionKey: Map<string, RawSubagentRow>;
  latestRunsByKey: Map<string, LatestRunInfo>;
  pendingApprovalsByKey: Map<string, number>;
}): TranscriptConversationSummary[] {
  return input.sessions.map((session) => {
    const subagentRow = input.subagentsBySessionKey.get(session.sessionKey);
    const latestRun = input.latestRunsByKey.get(session.sessionKey);
    const pendingApprovalCount = input.pendingApprovalsByKey.get(session.sessionKey) ?? 0;
    return {
      conversation_id: session.sessionId,
      conversation_key: session.sessionKey,
      agent_key: session.agentKey,
      channel: session.channel,
      account_key: session.accountKey ?? undefined,
      thread_id: session.threadId,
      container_kind: session.containerKind ?? undefined,
      title: session.title,
      message_count: session.messageCount,
      updated_at: session.updatedAt,
      created_at: session.createdAt,
      archived: session.archived,
      parent_conversation_key: subagentRow?.parent_session_key ?? undefined,
      subagent_id: subagentRow?.subagent_id ?? undefined,
      execution_profile: subagentRow?.execution_profile ?? undefined,
      subagent_status: subagentRow?.status as TranscriptConversationSummary["subagent_status"],
      latest_turn_id: latestRun?.latestTurnId ?? null,
      latest_turn_status: latestRun?.latestTurnStatus ?? null,
      has_active_turn: latestRun?.hasActiveTurn ?? false,
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
    const parentSessionKey = child.parent_conversation_key?.trim();
    if (!parentSessionKey) {
      continue;
    }
    const siblings = childrenByParentKey.get(parentSessionKey) ?? [];
    siblings.push(child);
    childrenByParentKey.set(parentSessionKey, siblings);
  }

  const attachChildren = (
    summary: TranscriptConversationSummary,
  ): TranscriptConversationSummary => {
    const childSessions = childrenByParentKey
      .get(summary.conversation_key)
      ?.toSorted((left, right) => left.created_at.localeCompare(right.created_at))
      .map(attachChildren);
    return childSessions && childSessions.length > 0
      ? { ...summary, child_conversations: childSessions }
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
