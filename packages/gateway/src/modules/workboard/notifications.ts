import type { WorkItem, WorkScope } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { PolicyService } from "../policy/service.js";
import { ChannelOutboxDal } from "../channels/outbox-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { SessionSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { WorkboardDal } from "./dal.js";

type WorkItemTerminalState = "blocked" | "done" | "failed";

function isTerminalState(status: WorkItem["status"]): status is WorkItemTerminalState {
  return status === "blocked" || status === "done" || status === "failed";
}

function buildNotificationText(item: WorkItem): string {
  switch (item.status) {
    case "done":
      return `Work item completed: ${item.title}`;
    case "blocked":
      return `Work item blocked: ${item.title}`;
    case "failed":
      return `Work item failed: ${item.title}`;
    default:
      return `Work item updated: ${item.title}`;
  }
}

export async function enqueueWorkItemStateChangeNotification(input: {
  db: SqlDb;
  scope: WorkScope;
  item: WorkItem;
  policyService?: PolicyService;
  approvalDal?: ApprovalDal;
}): Promise<{ enqueued: boolean; deduped?: boolean; skipped_reason?: string }> {
  if (!isTerminalState(input.item.status)) {
    return { enqueued: false, skipped_reason: "status_not_notifiable" };
  }

  const workboard = new WorkboardDal(input.db);
  const activity = await workboard.getScopeActivity({ scope: input.scope });
  const targetSessionKey = activity?.last_active_session_key ?? input.item.created_from_session_key;

  const sendOverride = await new SessionSendPolicyOverrideDal(input.db).get({
    key: targetSessionKey,
  });
  if (sendOverride?.send_policy === "off") {
    return { enqueued: false, skipped_reason: "send_policy_off" };
  }

  const route = await input.db.get<{
    inbox_id: number;
    source: string;
    thread_id: string;
  }>(
    `SELECT inbox_id, source, thread_id
     FROM channel_inbox
     WHERE key = ?
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    [targetSessionKey],
  );

  if (!route) {
    return { enqueued: false, skipped_reason: "no_channel_route" };
  }

  const updatedAtIso = (input.item.updated_at ?? input.item.created_at).trim();
  const dedupeKey = `work.notify:${input.item.work_item_id}:${input.item.status}:${updatedAtIso}`;

  const outbox = new ChannelOutboxDal(input.db);
  const existing = await outbox.getByDedupeKey(dedupeKey);
  if (existing) {
    return { enqueued: true, deduped: true };
  }

  let decision: "allow" | "deny" | "require_approval" = "allow";
  let policySnapshotId: string | undefined;

  const policyService = input.policyService;
  if (policyService?.isEnabled()) {
    try {
      const parsedSource = parseChannelSourceKey(route.source);
      const matchTarget =
        parsedSource.accountId === DEFAULT_CHANNEL_ACCOUNT_ID
          ? `${parsedSource.connector}:${route.thread_id}`
          : `${parsedSource.connector}:${parsedSource.accountId}:${route.thread_id}`;
      const evalRes = await policyService.evaluateConnectorAction({
        agentId: input.scope.agent_id,
        workspaceId: input.scope.workspace_id,
        matchTarget,
      });
      decision = evalRes.decision;
      policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
    } catch {
      decision = "require_approval";
    }

    if (policyService.isObserveOnly()) {
      decision = "allow";
    }
  }

  if (sendOverride?.send_policy === "on") {
    decision = "allow";
  }

  if (decision === "deny" && policyService?.isEnabled() && !policyService.isObserveOnly()) {
    return { enqueued: false, skipped_reason: "policy_denied" };
  }

  let approvalId: number | undefined;
  if (decision === "require_approval") {
    if (!input.approvalDal) {
      return { enqueued: false, skipped_reason: "approval_required" };
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const approval = await input.approvalDal.create({
      planId: `connector:work.notify:${route.source}:${route.thread_id}:${input.item.work_item_id}:${updatedAtIso}`,
      stepIndex: 0,
      kind: "connector.send",
      agentId: input.scope.agent_id,
      workspaceId: input.scope.workspace_id,
      key: targetSessionKey,
      lane: "main",
      prompt: `Approve sending a ${route.source} completion notification`,
      context: {
        source: route.source,
        thread_id: route.thread_id,
        inbox_id: route.inbox_id,
        policy_snapshot_id: policySnapshotId,
        work_item: {
          work_item_id: input.item.work_item_id,
          status: input.item.status,
          title: input.item.title,
        },
      },
      expiresAt,
    });
    approvalId = approval.id;
  }

  const { deduped, row } = await outbox.enqueue({
    inbox_id: route.inbox_id,
    source: route.source,
    thread_id: route.thread_id,
    dedupe_key: dedupeKey,
    chunk_index: 0,
    text: buildNotificationText(input.item),
  });

  if (approvalId && !deduped && row.approval_id === null) {
    await input.db.run(
      `UPDATE channel_outbox
       SET approval_id = ?
       WHERE outbox_id = ? AND status = 'queued' AND approval_id IS NULL`,
      [approvalId, row.outbox_id],
    );
  }

  return { enqueued: true, deduped };
}
