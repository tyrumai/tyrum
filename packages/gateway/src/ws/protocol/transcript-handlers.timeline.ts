import type {
  TranscriptSessionSummary,
  TranscriptTimelineEvent,
  TyrumUIMessage,
} from "@tyrum/contracts";
import { ApprovalDal } from "../../modules/approval/dal.js";
import { toApprovalContract } from "../../modules/approval/to-contract.js";
import type { ProtocolDeps } from "./types.js";
import { buildSqlPlaceholders } from "./transcript-handlers.data.js";

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

export async function resolveApprovalEvents(input: {
  deps: ProtocolDeps;
  tenantId: string;
  sessionIds: string[];
  sessionKeyByRunId: Map<string, string>;
  stepIds: string[];
  attemptIds: string[];
  runIds: string[];
  summaryBySessionKey: Map<string, TranscriptSessionSummary>;
}): Promise<TranscriptTimelineEvent[]> {
  if (!input.deps.db) {
    return [];
  }
  const clauses: string[] = [];
  const params: unknown[] = [input.tenantId];
  if (input.sessionIds.length > 0) {
    clauses.push(`session_id IN (${buildSqlPlaceholders(input.sessionIds.length)})`);
    params.push(...input.sessionIds);
  }
  if (input.runIds.length > 0) {
    clauses.push(`run_id IN (${buildSqlPlaceholders(input.runIds.length)})`);
    params.push(...input.runIds);
  }
  if (input.stepIds.length > 0) {
    clauses.push(`step_id IN (${buildSqlPlaceholders(input.stepIds.length)})`);
    params.push(...input.stepIds);
  }
  if (input.attemptIds.length > 0) {
    clauses.push(`attempt_id IN (${buildSqlPlaceholders(input.attemptIds.length)})`);
    params.push(...input.attemptIds);
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
  const seen = new Set<string>();
  const events: TranscriptTimelineEvent[] = [];

  for (const row of rows) {
    if (seen.has(row.approval_id)) {
      continue;
    }
    seen.add(row.approval_id);
    const approvalRow = await approvalDal.getById({
      tenantId: input.tenantId,
      approvalId: row.approval_id,
      includeReviews: true,
    });
    const approval = approvalRow ? toApprovalContract(approvalRow) : undefined;
    if (!approval) {
      continue;
    }
    const sessionKey =
      (typeof approval.scope?.run_id === "string"
        ? input.sessionKeyByRunId.get(approval.scope.run_id)
        : undefined) ??
      (approval.scope?.key?.trim() || "");
    if (!sessionKey) {
      continue;
    }
    const summary = input.summaryBySessionKey.get(sessionKey);
    events.push({
      event_id: `approval:${approval.approval_id}`,
      kind: "approval",
      occurred_at: approval.created_at,
      session_key: sessionKey,
      parent_session_key: summary?.parent_session_key,
      subagent_id: summary?.subagent_id,
      payload: { approval },
    });
  }

  return events;
}
